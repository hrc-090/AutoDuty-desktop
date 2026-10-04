/**
 * duty-core.js - 核心业务逻辑
 * 支持按组轮转值日表，值日日期可选
 */

const XLSX = require('xlsx');
const { pinyin } = require('pinyin-pro');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

// ==================== 写盘通知（供主进程识别“自身写入”） ====================
// 数据目录文件被应用自身保存时，主进程文件监听应忽略，避免误触发外部修改刷新
let onSelfWrite = null;
function setOnSelfWrite(fn) {
  onSelfWrite = fn;
}
function notifySelfWrite() {
  if (onSelfWrite) onSelfWrite();
}

// ==================== 日期调度 ====================

/**
 * 根据切换时间判断目标日期
 */
function getTargetDate(switchHour) {
  const now = new Date();
  let target = new Date(now);
  if (now.getHours() >= switchHour) {
    target.setDate(target.getDate() + 1);
  }
  return formatDate(target);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 日期归一化：支持 2026/6/8、2026-6-8、6.8 等格式
 * 短格式（无年份）自动补当前年份
 */
function normalizeDate(str) {
  if (!str) return '';
  str = String(str).trim();

  // 匹配 M.D 或 M.D-D 格式（如 6.1、6.1-6.2）
  const shortRangeMatch = str.match(/^(\d{1,2})\.(\d{1,2})(?:-(\d{1,2})\.?(\d{1,2})?)?$/);
  if (shortRangeMatch) {
    const y = new Date().getFullYear();
    const m1 = shortRangeMatch[1].padStart(2, '0');
    const d1 = shortRangeMatch[2].padStart(2, '0');
    if (shortRangeMatch[3]) {
      const m2 = (shortRangeMatch[4] ? shortRangeMatch[3] : shortRangeMatch[1]).padStart(2, '0');
      const d2 = (shortRangeMatch[4] || shortRangeMatch[3]).padStart(2, '0');
      return `${y}-${m1}-${d1}~${y}-${m2}-${d2}`;
    }
    return `${y}-${m1}-${d1}`;
  }

  // 标准格式 YYYY-MM-DD 或 YYYY/MM/DD
  const cleaned = str.replace(/[\/\.]/g, '-');
  const parts = cleaned.split('-');
  if (parts.length === 3) {
    const y = parts[0].length === 4 ? parts[0] : '20' + parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return str;
}

/**
 * 解析日期字符串为时段 {start, end}
 * - 范围 "6.1-6.2" → [6/1 switchHour:00, 6/2 switchHour:00)
 *   含义：从6.1设定时间过后到6.2设定时间前
 * - 单日期 "6.1" → [6/1 00:00, 6/2 00:00) 整个日历日
 * - 标准范围 "2026-06-01~2026-06-03" → [6/1 switch, 6/3 switch)
 */
function parseDatePeriod(dateStr, switchHour) {
  if (!dateStr) return null;
  const normalized = normalizeDate(dateStr);
  if (!normalized) return null;

  // 包含范围分隔符 ~
  const rangeParts = normalized.split('~');
  if (rangeParts.length === 2) {
    const startDate = new Date(rangeParts[0]);
    const endDate = new Date(rangeParts[1]);
    if (isNaN(startDate) || isNaN(endDate)) return null;

    // 时段：[起日 switchHour, 终日 switchHour)
    startDate.setHours(switchHour, 0, 0, 0);
    endDate.setHours(switchHour, 0, 0, 0);
    return { start: startDate, end: endDate };
  }

  // 单日期 → 整个日历日 [当日 00:00, 次日 00:00)
  const date = new Date(normalized);
  if (isNaN(date)) return null;

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setDate(end.getDate() + 1);
  end.setHours(0, 0, 0, 0);
  return { start, end };
}

/**
 * 解析日期范围字符串，返回日期数组（用于手动查日期的场景）
 */
function parseDateRange(dateStr) {
  if (!dateStr) return [];
  const normalized = normalizeDate(dateStr);
  if (!normalized) return [];

  const rangeParts = normalized.split('~');
  if (rangeParts.length === 2) {
    const start = new Date(rangeParts[0]);
    const end = new Date(rangeParts[1]);
    if (isNaN(start) || isNaN(end)) return [normalized];
    const dates = [];
    const cur = new Date(start);
    while (cur <= end) {
      dates.push(formatDate(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }

  return [normalized];
}

/**
 * 检查一个日期是否在值日日期范围内（手动查询用）
 */
function isDateInRange(targetDate, dateStr) {
  if (!dateStr) return false;
  const dates = parseDateRange(dateStr);
  return dates.includes(targetDate);
}

/**
 * 检查当前时间是否落在值日时段内（自动执行用）
 * "6.1-6.2" + switchHour=18 → 时段 [6/1 18:00, 6/2 18:00)
 */
function isNowInPeriod(dateStr, switchHour) {
  const period = parseDatePeriod(dateStr, switchHour);
  if (!period) return false;
  const now = new Date();
  return now >= period.start && now < period.end;
}

// ==================== Excel 操作 ====================

/**
 * 确保数据文件存在
 */
function ensureDataFiles(dataDir) {
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  const aliasPath = path.join(dataDir, 'aliases.xlsx');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dutyPath)) {
    const wb = XLSX.utils.book_new();
    const data = [
      ['星期', '扫', '拖', '倒', '伞', '值日日期', '组次', '注'],
      [null, '张三', '李四', '王五', '赵六', null, '1', null],
      [null, '钱七', '孙八', '周九', '吴十', null, '2', null],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, '值日表');
    XLSX.writeFile(wb, dutyPath);
  }

  if (!fs.existsSync(aliasPath)) {
    const wb = XLSX.utils.book_new();
    const data = [
      ['中文名', '别名'],
      ['张三', 'zs'],
      ['李四', 'lisi'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, '别名表');
    XLSX.writeFile(wb, aliasPath);
  }

  return { dutyPath, aliasPath };
}

/**
 * 读取值日表 - 返回原始结构（headers + rows）
 * 不再强制要求日期列
 */
function readDutyTable(dutyPath) {
  if (!fs.existsSync(dutyPath)) return { headers: [], rows: [] };

  const wb = XLSX.readFile(dutyPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (raw.length < 1) return { headers: [], rows: [] };

  const headers = raw[0].map(h => String(h || '').trim());
  const rows = raw.slice(1).map(row => {
    // 确保每行长度和表头一致
    const padded = [...row];
    while (padded.length < headers.length) padded.push(null);
    return padded.map(cell => cell != null ? String(cell).trim() : '');
  });

  return { headers, rows };
}

/**
 * 写回值日表 - 接受原始结构
 */
function writeDutyTable(dutyPath, data) {
  const { headers, rows } = data;
  const aoa = [headers, ...rows];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((_, i) => {
    // 日期列和值日日期列宽一些
    const h = headers[i] || '';
    if (h.includes('日期') || h.includes('时间')) return { wch: 16 };
    if (h === '注') return { wch: 20 };
    if (h === '组次') return { wch: 8 };
    return { wch: 14 };
  });
  XLSX.utils.book_append_sheet(wb, ws, '值日表');
  XLSX.writeFile(wb, dutyPath);
  notifySelfWrite();
}

/**
 * 查找"值日日期"列的索引
 */
function findDateColumnIndex(headers) {
  // 优先找"值日日期"
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].includes('值日日期') || headers[i].includes('日期')) return i;
  }
  return -1;
}

/**
 * 获取当前时段的值日信息（自动执行用）
 * 使用时段匹配：当前时间落在 [起日 switchHour, 终日 switchHour) 内则匹配
 * "6.1-6.2" + switchHour=18 → 匹配 6/1 18:00 ~ 6/2 18:00
 */
function getActiveDuty(dutyPath, switchHour, template) {
  const { headers, rows } = readDutyTable(dutyPath);
  if (rows.length === 0) return null;

  const dateColIdx = findDateColumnIndex(headers);
  if (dateColIdx < 0) return null;

  for (const row of rows) {
    const dateVal = row[dateColIdx];
    if (!dateVal) continue;

    if (isNowInPeriod(dateVal, switchHour)) {
      return buildDutyText(headers, row, template);
    }
  }

  return null;
}

/**
 * 根据 headers 和 row 拼接值日文本
 * @param {string[]} headers - 表头
 * @param {string[]} row - 行数据
 * @param {string} [template] - 自定义模板（如「今日值日生：{姓名}」）；为空时回退自动拼接
 * 占位符规则：
 *  - {表头}：替换对应列的值（如 {姓名}、{姓名2}、{日期}、{星期}）
 *  - {值日生}：所有任务列（非日期/星期/组次/注）的值用顿号连接
 *  - 未匹配到的占位符会被清空
 */
function buildDutyText(headers, row, template) {
  if (template && String(template).trim()) {
    return renderDutyTemplate(template, headers, row);
  }

  const skipCols = new Set();
  headers.forEach((h, i) => {
    if (['星期', '值日日期', '组次', '注'].includes(h) || h.includes('日期')) {
      skipCols.add(i);
    }
  });

  const parts = [];
  headers.forEach((h, i) => {
    if (skipCols.has(i)) return;
    if (row[i]) {
      parts.push(`${h}：${row[i]}`);
    }
  });

  return parts.length > 0 ? parts.join('、') : null;
}

/**
 * 用自定义模板渲染值日文本（{表头} 占位符替换）
 */
function renderDutyTemplate(template, headers, row) {
  const skipCols = new Set();
  headers.forEach((h, i) => {
    if (['星期', '值日日期', '组次', '注'].includes(h) || String(h || '').includes('日期')) {
      skipCols.add(i);
    }
  });

  // {值日生}：所有任务列（人员列）的值用顿号连接
  const personParts = [];
  headers.forEach((h, i) => {
    if (skipCols.has(i)) return;
    const v = row[i];
    if (v != null && String(v).trim()) personParts.push(String(v).trim());
  });
  const personText = personParts.join('、');

  let out = String(template);
  const used = new Set();
  const placeholderKeys = [...String(template).matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

  for (const key of placeholderKeys) {
    if (used.has(key)) continue;
    used.add(key);

    let val = '';
    if (key === '值日生') {
      val = personText;
    } else {
      // 精确表头优先；其次去掉末尾数字后比较；再退化为包含关系
      const plain = key.replace(/\d+$/, '');
      let idx = -1;
      for (let i = 0; i < headers.length; i++) {
        if (String(headers[i] || '') === key) { idx = i; break; }
      }
      if (idx < 0) {
        for (let i = 0; i < headers.length; i++) {
          if (String(headers[i] || '').replace(/\d+$/, '') === plain) { idx = i; break; }
        }
      }
      if (idx < 0) {
        for (let i = 0; i < headers.length; i++) {
          const h = String(headers[i] || '');
          if (h.includes(key) || key.includes(h)) { idx = i; break; }
        }
      }
      if (idx >= 0) val = cellText(row[idx]);
    }
    out = out.split(`{${key}}`).join(val);
  }

  // 清理未匹配到的占位符
  return out.replace(/\{[^}]*\}/g, '');
}

function cellText(v) {
  return v != null && v !== '' ? String(v) : '';
}

/**
 * 获取指定日期的值日信息（手动查询用）
 * 在值日日期列中查找匹配的行
 */
function getDutyForDate(dutyPath, targetDate, template) {
  const { headers, rows } = readDutyTable(dutyPath);
  if (rows.length === 0) return null;

  const dateColIdx = findDateColumnIndex(headers);

  if (dateColIdx >= 0) {
    for (const row of rows) {
      const dateVal = row[dateColIdx];
      if (dateVal && isDateInRange(targetDate, dateVal)) {
        return buildDutyText(headers, row, template);
      }
    }
  }

  return null;
}

/**
 * 获取下一个未分配日期的行索引
 */
function getNextUnassignedRowIndex(dutyPath) {
  const { headers, rows } = readDutyTable(dutyPath);
  if (rows.length === 0) return -1;

  const dateColIdx = findDateColumnIndex(headers);
  if (dateColIdx < 0) return 0;

  for (let i = 0; i < rows.length; i++) {
    if (!rows[i][dateColIdx]) return i;
  }
  return -1; // 全部分配了
}

/**
 * 批量分配值日日期：自动从「已有日期最大结束日的次日」（无则明天）开始，
 * 以「值日星期」（1=周一 … 7=周日）作为交接日；每行（组）写入
 * 「交接日-下一交接日」范围（如 9.23-9.24、9.24-9.29，含下一交接日作为
 * 交接边界，与表格既有手写格式 7.1-7.2、7.8-7.11 统一，不写单日）。
 * 一直填到所有未分配行为止（安全上限 5 年）。
 * @param {string} dutyPath - 值日表路径
 * @param {number[]} weekdays - 值日星期（交接日）集合（1=周一 … 7=周日）
 * @returns {{ assigned: number, message: string }}
 */
function assignDates(dutyPath, weekdays) {
  const { headers, rows } = readDutyTable(dutyPath);
  if (rows.length === 0) return { assigned: 0, message: '值日表为空' };

  const dateColIdx = findDateColumnIndex(headers);
  if (dateColIdx < 0) return { assigned: 0, message: '未找到日期列' };

  if (!Array.isArray(weekdays) || weekdays.length === 0) {
    return { assigned: 0, message: '请至少选择一个值日星期' };
  }
  const daySet = new Set(weekdays.map(Number));

  // 未分配行（日期列为空），同时统计已有日期的最大结束日
  const unassignedIndices = [];
  let maxEndMs = 0;
  for (let i = 0; i < rows.length; i++) {
    const cell = String(rows[i][dateColIdx] ?? '').trim();
    if (!cell) {
      unassignedIndices.push(i);
      continue;
    }
    const normalized = String(normalizeDate(cell));
    const parts = normalized.split('~');
    const last = parts[parts.length - 1];
    const d = new Date(last);
    if (!isNaN(d)) maxEndMs = Math.max(maxEndMs, d.getTime());
  }

  if (unassignedIndices.length === 0) {
    return { assigned: 0, message: '所有行已分配日期' };
  }

  // 起点：已有日期 → 最大结束日的次日；否则明天
  const cur = maxEndMs > 0 ? new Date(maxEndMs) : new Date();
  cur.setHours(0, 0, 0, 0);
  if (maxEndMs > 0) cur.setDate(cur.getDate() + 1);
  else cur.setDate(cur.getDate() + 1);

  // JS getDay()：0=周日…6=周六 → 统一为 1=周一…7=周日
  const toWeekday = (d) => (d.getDay() === 0 ? 7 : d.getDay());

  // 收集交接日：需要 未分配行数+1 个（第 N+1 个用于确定最后一组的结束日）
  const need = unassignedIndices.length + 1;
  const handovers = [];
  let d = new Date(cur);
  while (handovers.length < need && d.getFullYear() - cur.getFullYear() <= 5) {
    if (daySet.has(toWeekday(d))) handovers.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  if (handovers.length < need) {
    return { assigned: 0, message: '日期计算异常，请重试' };
  }

  // 短格式：9.23（不含年份与补零）
  const fmt = (dt) => `${dt.getMonth() + 1}.${dt.getDate()}`;

  // 每行写「交接日-下一交接日」范围（含下一交接日作为交接边界）：
  // 连续交接日 → 9.23-9.24；有间隔 → 9.24-9.29；末行也照常写范围。
  // 语义与 parseDatePeriod 一致（范围 = [起日切换时刻, 终日切换时刻)），
  // 与本表既有手写格式（7.1-7.2、7.8-7.11）统一。
  // 第 N+1 个交接日已收集（need = 行数+1），末行同样可写范围。
  for (let i = 0; i < unassignedIndices.length; i++) {
    const s = handovers[i];
    const e = handovers[i + 1];
    rows[unassignedIndices[i]][dateColIdx] = `${fmt(s)}-${fmt(e)}`;
  }

  // 写回
  writeDutyTable(dutyPath, { headers, rows });

  return { assigned: unassignedIndices.length, message: `已分配 ${unassignedIndices.length} 组的值日日期` };
}

// ==================== 别名管理 ====================

/**
 * 加载别名词典
 */
function loadAliases(aliasPath) {
  const aliasDict = {};

  if (!fs.existsSync(aliasPath)) return aliasDict;

  const wb = XLSX.readFile(aliasPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[0]) continue;

    const realName = String(row[0]).trim();
    const manualAlias = row[1] ? String(row[1]).trim() : '';

    const addEntry = (key, name) => {
      const k = key.toLowerCase();
      if (!aliasDict[k]) aliasDict[k] = [];
      if (!aliasDict[k].includes(name)) aliasDict[k].push(name);
    };

    // 手动别名
    if (manualAlias) addEntry(manualAlias, realName);

    // 自动生成全拼
    const fullPinyin = pinyin(realName, { toneType: 'none', type: 'array' })
      .join('')
      .toLowerCase();
    addEntry(fullPinyin, realName);

    // 自动生成简拼
    const shortPinyin = pinyin(realName, { toneType: 'none', pattern: 'first', type: 'array' })
      .join('')
      .toLowerCase();
    addEntry(shortPinyin, realName);
  }

  return aliasDict;
}

/**
 * 读取别名表原始数据
 */
function readAliasTable(aliasPath) {
  if (!fs.existsSync(aliasPath)) return [];

  const wb = XLSX.readFile(aliasPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1)
    .filter(row => row && row[0])
    .map(row => ({
      name: String(row[0]).trim(),
      alias: row[1] ? String(row[1]).trim() : '',
    }));
}

/**
 * 写回别名表
 */
function writeAliasTable(aliasPath, entries) {
  const data = [['中文名', '别名']];
  entries.forEach(e => data.push([e.name, e.alias]));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '别名表');
  XLSX.writeFile(wb, aliasPath);
  notifySelfWrite();
}

/**
 * 自动填充值日表中的别名/拼音为真实姓名
 */
function fillDutyWithRealNames(dutyPath, aliasDict) {
  if (!fs.existsSync(dutyPath)) return { changed: false, ambiguities: [] };

  const wb = XLSX.readFile(dutyPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (raw.length < 2) return { changed: false, ambiguities: [] };

  const headers = raw[0];
  let changed = false;
  const ambiguities = [];

  // 跳过非任务列（星期、值日日期、组次、注等）
  const skipCols = new Set();
  headers.forEach((h, i) => {
    const hl = String(h || '').toLowerCase();
    if (['星期', '值日日期', '组次', '注'].includes(String(h || '')) || hl.includes('日期')) {
      skipCols.add(i);
    }
  });

  for (let r = 1; r < raw.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      if (skipCols.has(c)) continue;

      const cellVal = raw[r][c];
      if (!cellVal || typeof cellVal !== 'string') continue;

      const original = cellVal.trim();
      const parts = original.split(/[,，、\s]+/).filter(Boolean);
      if (!parts.length) continue;

      const newParts = [];
      let cellChanged = false;

      for (const part of parts) {
        const key = part.toLowerCase();
        if (aliasDict[key]) {
          const names = aliasDict[key];
          if (names.length > 1) {
            ambiguities.push({ row: r, col: c, key, names, original: part });
            newParts.push(part);
          } else {
            newParts.push(names[0]);
            if (names[0] !== part) cellChanged = true;
          }
        } else {
          newParts.push(part);
        }
      }

      if (cellChanged) {
        raw[r][c] = newParts.join('、');
        changed = true;
      }
    }
  }

  if (changed) {
    const newWs = XLSX.utils.aoa_to_sheet(raw);
    newWs['!cols'] = headers.map((_, i) => {
      const h = String(headers[i] || '');
      if (h.includes('日期') || h.includes('时间')) return { wch: 16 };
      if (h === '注') return { wch: 20 };
      return { wch: 14 };
    });
    wb.Sheets[wb.SheetNames[0]] = newWs;
    XLSX.writeFile(wb, dutyPath);
    notifySelfWrite();
  }

  return { changed, ambiguities };
}

// ==================== 通知发送 ====================

async function sendNotification(apiUrl, content) {
  if (!content) {
    return { success: false, message: '没有值日信息，跳过发送' };
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: content,
    });

    if (response.ok) {
      return { success: true, message: '发送成功' };
    } else {
      return { success: false, message: `发送失败：HTTP ${response.status}` };
    }
  } catch (err) {
    return { success: false, message: `发送出错：${err.message}` };
  }
}

// ==================== 一键执行 ====================

async function runDuty(dataDir, switchHour, apiUrl, template) {
  const { dutyPath, aliasPath } = ensureDataFiles(dataDir);
  const aliasDict = loadAliases(aliasPath);

  // 先自动填充
  fillDutyWithRealNames(dutyPath, aliasDict);

  // 使用时段匹配：当前时间落在某个值日时段内则匹配
  const targetDate = getTargetDate(switchHour);
  const dutyText = getDutyForDate(dutyPath, targetDate, template);

  if (!dutyText) {
    return {
      success: false,
      targetDate,
      message: `${targetDate} 没有值日安排，不发送`,
      dutyText: null,
    };
  }

  // 发送通知
  const result = await sendNotification(apiUrl, dutyText);

  return {
    ...result,
    targetDate,
    dutyText,
  };
}

// ==================== 导入功能 ====================

/**
 * 从外部 xlsx 导入值日表
 * 直接原样导入，不要求日期列
 */
function importDutyTable(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) {
    return { success: false, message: '源文件不存在' };
  }

  const wb = XLSX.readFile(srcPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (raw.length < 2) {
    return { success: false, message: '文件为空或没有数据行' };
  }

  // 原样写入，不做任何转换
  const newWb = XLSX.utils.book_new();
  const newWs = XLSX.utils.aoa_to_sheet(raw);
  const headers = raw[0] || [];
  newWs['!cols'] = headers.map((h) => {
    const hs = String(h || '');
    if (hs.includes('日期') || hs.includes('时间')) return { wch: 16 };
    if (hs === '注') return { wch: 20 };
    return { wch: 14 };
  });
  XLSX.utils.book_append_sheet(newWb, newWs, '值日表');
  XLSX.writeFile(newWb, destPath);
  notifySelfWrite();

  const rowCount = raw.length - 1;
  return { success: true, message: `导入成功，共 ${rowCount} 条记录` };
}

/**
 * 从外部 xlsx 导入别名表
 */
function importAliasTable(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) {
    return { success: false, message: '源文件不存在' };
  }

  const wb = XLSX.readFile(srcPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  if (raw.length < 2) {
    return { success: false, message: '文件为空或没有数据行' };
  }

  const newWb = XLSX.utils.book_new();
  const newWs = XLSX.utils.aoa_to_sheet(raw);
  XLSX.utils.book_append_sheet(newWb, newWs, '别名表');
  XLSX.writeFile(newWb, destPath);
  notifySelfWrite();

  const rowCount = raw.length - 1;
  return { success: true, message: `导入成功，共 ${rowCount} 条记录` };
}

module.exports = {
  getTargetDate,
  formatDate,
  normalizeDate,
  parseDatePeriod,
  parseDateRange,
  isDateInRange,
  isNowInPeriod,
  setOnSelfWrite,
  ensureDataFiles,
  readDutyTable,
  writeDutyTable,
  findDateColumnIndex,
  getActiveDuty,
  buildDutyText,
  getDutyForDate,
  getNextUnassignedRowIndex,
  assignDates,
  getAllDates: () => [],
  loadAliases,
  readAliasTable,
  writeAliasTable,
  fillDutyWithRealNames,
  sendNotification,
  runDuty,
  importDutyTable,
  importAliasTable,
};
