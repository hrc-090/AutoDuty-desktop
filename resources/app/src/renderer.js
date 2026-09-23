/**
 * renderer.js - 渲染进程逻辑
 * 支持按组轮转值日表，值日日期可选
 */

const api = window.autoduty;

// ==================== 通用工具 ====================

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function showToast(msg, duration = 2500) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

// ==================== 标题栏 ====================

$('#btn-minimize').onclick = () => api.minimize();
$('#btn-close').onclick = () => api.close();

// ==================== 标签页切换 ====================

$$('.tab').forEach(btn => {
  btn.onclick = () => {
    $$('.tab').forEach(b => b.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');

    if (btn.dataset.tab === 'home') loadHome();
    if (btn.dataset.tab === 'duty') loadDutyTable();
    if (btn.dataset.tab === 'alias') loadAliasTable();
    if (btn.dataset.tab === 'settings') loadSettings();
  };
});

// ==================== 首页 ====================

async function loadHome() {
  const manualDate = $('#input-manual-date').value;
  let preview;
  if (manualDate) {
    preview = await api.previewDutyDate(manualDate);
  } else {
    preview = await api.previewDuty();
  }
  $('#duty-text').textContent = preview.dutyText || '无值日安排（未分配日期或当天无数据）';
}

$('#btn-lookup-date').onclick = () => loadHome();
$('#input-manual-date').onchange = () => loadHome();

$('#btn-execute').onclick = async () => {
  $('#btn-execute').disabled = true;
  $('#btn-execute').textContent = '执行中...';
  await api.executeDuty();
};

api.onDutyResult((result) => {
  const msg = result.success
    ? `✅ ${result.message}`
    : `❌ ${result.message}`;
  $('#last-result').textContent = msg;
  showToast(msg);
  $('#btn-execute').disabled = false;
  $('#btn-execute').textContent = '立即执行';
  loadHome();
});

// ==================== 值日表管理 ====================

let dutyHeaders = [];
let dutyRows = [];

async function loadDutyTable() {
  const data = await api.getDutyAll();
  dutyHeaders = data.headers || [];
  dutyRows = data.rows || [];
  renderDutyTable();
}

function renderDutyTable() {
  // 表头
  const headerRow = $('#duty-table-header');
  headerRow.innerHTML = dutyHeaders.map(h => `<th>${h}</th>`).join('') + '<th>操作</th>';

  // 表体
  const tbody = $('#duty-table-body');
  tbody.innerHTML = '';

  dutyRows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    dutyHeaders.forEach((h, colIdx) => {
      const td = document.createElement('td');
      td.textContent = row[colIdx] || '';
      td.contentEditable = true;
      td.dataset.row = idx;
      td.dataset.col = colIdx;

      // 日期列高亮
      if (h.includes('日期')) {
        td.classList.add('date-cell');
      }
      tr.appendChild(td);
    });

    // 删除按钮
    const delTd = document.createElement('td');
    delTd.innerHTML = `<button class="btn-delete" data-idx="${idx}">删除</button>`;
    tr.appendChild(delTd);

    tbody.appendChild(tr);
  });

  // 绑定编辑事件
  tbody.querySelectorAll('[contenteditable]').forEach(td => {
    td.onblur = () => {
      const r = parseInt(td.dataset.row);
      const c = parseInt(td.dataset.col);
      dutyRows[r][c] = td.textContent.trim();
    };
  });

  // 删除事件
  tbody.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      dutyRows.splice(idx, 1);
      renderDutyTable();
    };
  });
}

$('#btn-add-duty-row').onclick = () => {
  const newRow = dutyHeaders.map(() => '');
  dutyRows.push(newRow);
  renderDutyTable();
};

$('#btn-save-duty').onclick = async () => {
  await api.saveDuty({ headers: dutyHeaders, rows: dutyRows });
  showToast('值日表已保存');
};

$('#btn-fill-names').onclick = async () => {
  const result = await api.fillNames();
  if (result.changed) {
    showToast('已自动填充姓名');
    loadDutyTable();
  } else {
    showToast('无需填充');
  }
};

// 导入值日表
$('#btn-import-duty').onclick = async () => {
  const result = await api.importDuty();
  if (result.success) {
    showToast(result.message);
    await loadDutyTable();
    await loadHome();
  } else if (result.message !== '已取消') {
    showToast(result.message);
  }
};

// 分配日期面板
$('#btn-assign-dates').onclick = () => {
  const panel = $('#assign-panel');
  panel.classList.toggle('hidden');

  // 默认起始日期为明天
  if (!panel.classList.contains('hidden') && !$('#input-assign-start').value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    $('#input-assign-start').value = tomorrow.toISOString().split('T')[0];
  }
};

$('#btn-assign-cancel').onclick = () => {
  $('#assign-panel').classList.add('hidden');
};

$('#btn-assign-confirm').onclick = async () => {
  const startDate = $('#input-assign-start').value;
  if (!startDate) {
    showToast('请选择起始日期');
    return;
  }

  const count = parseInt($('#input-assign-count').value) || 0;
  const skipWeekends = $('#input-assign-skip-weekend').checked;

  const result = await api.assignDates({ startDate, count, skipWeekends });
  showToast(result.message);

  if (result.assigned > 0) {
    $('#assign-panel').classList.add('hidden');
    await loadDutyTable();
    await loadHome();
  }
};

// ==================== 别名表管理 ====================

let aliasData = [];

async function loadAliasTable() {
  aliasData = await api.getAliasAll();
  renderAliasTable();
}

function renderAliasTable() {
  const tbody = $('#alias-table-body');
  tbody.innerHTML = '';

  aliasData.forEach((entry, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td contenteditable="true" data-idx="${idx}" data-field="name">${entry.name}</td>
      <td contenteditable="true" data-idx="${idx}" data-field="alias">${entry.alias}</td>
      <td><button class="btn-delete" data-idx="${idx}">删除</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[contenteditable]').forEach(td => {
    td.onblur = () => {
      const idx = parseInt(td.dataset.idx);
      aliasData[idx][td.dataset.field] = td.textContent.trim();
    };
  });

  tbody.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = () => {
      aliasData.splice(parseInt(btn.dataset.idx), 1);
      renderAliasTable();
    };
  });
}

$('#btn-add-alias-row').onclick = () => {
  aliasData.push({ name: '', alias: '' });
  renderAliasTable();
};

$('#btn-save-alias').onclick = async () => {
  await api.saveAlias(aliasData);
  showToast('别名表已保存');
};

$('#btn-import-alias').onclick = async () => {
  const result = await api.importAlias();
  if (result.success) {
    showToast(result.message);
    await loadAliasTable();
  } else if (result.message !== '已取消') {
    showToast(result.message);
  }
};

// ==================== 设置 ====================

async function loadSettings() {
  const config = await api.getConfig();
  $('#input-api-url').value = config.apiUrl || '';
  $('#input-switch-hour').value = config.switchHour;
  $('#input-auto-notify').checked = config.autoNotify;
  $('#input-auto-start').checked = config.autoStart;
  $('#input-start-hidden').checked = config.startHidden;
  $('#input-register-protocol').checked = config.registerProtocol;
  $('#input-update-url').value = config.updateUrl || '';
  $('#input-auto-update').checked = config.autoUpdate;
  $('#update-current-version').textContent = config.currentVersion || '-';
}

$('#btn-save-settings').onclick = async () => {
  const config = {
    apiUrl: $('#input-api-url').value.trim(),
    switchHour: parseInt($('#input-switch-hour').value),
    autoNotify: $('#input-auto-notify').checked,
    autoStart: $('#input-auto-start').checked,
    startHidden: $('#input-start-hidden').checked,
    registerProtocol: $('#input-register-protocol').checked,
    updateUrl: $('#input-update-url').value.trim(),
    autoUpdate: $('#input-auto-update').checked,
  };
  await api.setConfig(config);
  showToast('设置已保存');
};

// ==================== 软件更新 ====================

function renderUpdateResult(r) {
  const box = $('#update-result');
  const dlBtn = $('#btn-download-update');
  dlBtn.style.display = 'none';
  if (!r) {
    box.textContent = '';
    return;
  }
  if (r.error) {
    box.textContent = r.error;
    return;
  }
  if (r.hasUpdate && r.latest) {
    let html = `发现新版本 v${r.latest}（当前 v${r.current}）`;
    if (r.note) html += `<br><small>${String(r.note).replace(/</g, '&lt;')}</small>`;
    box.innerHTML = html;
    if (r.url) {
      dlBtn.style.display = 'inline-block';
      dlBtn.dataset.url = r.url;
    }
  } else if (r.latest) {
    box.textContent = `已是最新版本 v${r.latest}`;
  } else {
    box.textContent = '暂无可用更新';
  }
}

$('#btn-check-update').onclick = async () => {
  const r = await api.checkUpdate(true);
  renderUpdateResult(r);
};

$('#btn-download-update').onclick = async () => {
  const url = $('#btn-download-update').dataset.url;
  if (!url) return;
  const res = await api.downloadUpdate(url);
  if (res.success) {
    showToast(`更新包已下载：${res.path}`);
  } else {
    showToast(res.message || '下载失败');
  }
};

// 启动后若有新版本，后台推送提示
api.onUpdateAvailable((info) => {
  if (info && info.hasUpdate) {
    showToast(`发现新版本 v${info.latest}，请到「设置 → 软件更新」查看`);
  }
});

// ==================== 初始化 ====================

loadHome();
