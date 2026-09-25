<template>
  <ScrollViewer class="ad-scroll" VerticalScrollBarVisibility="Auto" VerticalScrollMode="Auto">
    <div class="ad-page">
      <div class="ad-toolbar">
        <TextBlock class="ad-page-title" Text="值日安排表" FontSize="24" FontWeight="600" />
        <div class="ad-toolbar-actions">
          <Button Style="SubtleButtonStyle" Content="导入 Excel" @Click="onImport" />
          <Button Style="SubtleButtonStyle" Content="分配日期" @Click="toggleAssign" />
          <Button Style="SubtleButtonStyle" Content="+ 添加行" @Click="addRow" />
        </div>
      </div>

      <Border v-if="assignOpen" class="ad-card ad-assign">
        <div class="ad-field">
          <TextBlock class="ad-label" Text="起始日期" FontSize="14" />
          <input type="date" class="ad-input" v-model="assignStart" />
        </div>
        <div class="ad-field">
          <TextBlock class="ad-label" Text="分配天数（0=全部）" FontSize="14" />
          <input type="number" class="ad-input ad-number" v-model.number="assignCount" min="0" />
        </div>
        <ToggleSwitch Header="跳过周末" :IsOn="assignSkipWeekend" @update:IsOn="assignSkipWeekend = $event" />
        <div class="ad-row">
          <Button Style="AccentButtonStyle" Content="确认分配" @Click="onAssignConfirm" />
          <Button Style="DefaultButtonStyle" Content="取消" @Click="toggleAssign" />
        </div>
      </Border>

      <!-- Excel 风格网格 -->
      <div class="ad-sheet" ref="sheetEl"></div>

      <div class="ad-row">
        <Button Style="AccentButtonStyle" Content="保存值日表" @Click="onSave" />
        <Button Style="DefaultButtonStyle" Content="自动填充姓名" @Click="onFillNames" />
      </div>
    </div>
  </ScrollViewer>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import ScrollViewer from '@winui/components/ScrollViewer.vue';
import TextBlock from '@winui/components/TextBlock.vue';
import Border from '@winui/components/Border.vue';
import Button from '@winui/components/Button.vue';
import ToggleSwitch from '@winui/components/ToggleSwitch.vue';
import Spreadsheet from 'x-data-spreadsheet/src/index';
import 'x-data-spreadsheet/dist/xspreadsheet.css';
import zhCN from '../xspreadsheet-zh';
import { useAutoduty } from '../useAutoduty';
import { showToast } from '../toast';

Spreadsheet.locale('zh-cn', zhCN);

const api = useAutoduty();
const sheetEl = ref(null);
let sheet = null;

const assignOpen = ref(false);
const assignStart = ref('');
const assignCount = ref(0);
const assignSkipWeekend = ref(true);

// 值日表数据 { headers, rows } → x-spreadsheet 数据（首行为表头）
function toSheetData(headers, rows) {
  const data = { rows: {} };
  const hLen = (headers || []).length;
  const rLen = Math.max(...(rows || []).map((r) => r.length), 0);
  const maxC = Math.max(hLen, rLen, 1);
  const headerRow = { cells: {} };
  (headers || []).forEach((h, c) => {
    headerRow.cells[c + 1] = { text: String(h ?? '') };
  });
  data.rows[1] = headerRow;
  (rows || []).forEach((row, r) => {
    const cells = {};
    for (let c = 0; c < maxC; c += 1) {
      const v = row[c];
      if (v !== undefined && v !== null && v !== '') cells[c + 1] = { text: String(v) };
    }
    data.rows[r + 2] = { cells };
  });
  return data;
}

// x-spreadsheet 数据 → 值日表数据（首行还原为表头）
function fromSheetData(data) {
  const headers = [];
  const rows = [];
  const rowKeys = Object.keys(data.rows || {})
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  let maxC = 0;
  const raw = {};
  rowKeys.forEach((r) => {
    const cells = (data.rows[r] || {}).cells || {};
    const row = [];
    Object.keys(cells).forEach((c) => {
      const ci = Number(c);
      if (Number.isFinite(ci)) {
        row[ci - 1] = (cells[c] || {}).text ?? '';
        if (ci > maxC) maxC = ci;
      }
    });
    raw[r] = row;
  });
  for (let c = 0; c < maxC; c += 1) {
    headers[c] = (raw[1] || [])[c] || '';
  }
  for (let r = 2; r <= rowKeys[rowKeys.length - 1]; r += 1) {
    const row = [];
    for (let c = 0; c < maxC; c += 1) row[c] = (raw[r] || [])[c] || '';
    rows.push(row);
  }
  return { headers, rows };
}

async function loadDutyTable() {
  if (!api || !sheet) return;
  const data = await api.getDutyAll();
  sheet.loadData(toSheetData(data.headers || [], data.rows || []));
}

function addRow() {
  if (!sheet) return;
  // 在数据区末尾追加一个空行（首行表头之外）
  const data = sheet.getData();
  const lastRow = Math.max(...Object.keys(data.rows || {}).map(Number).filter(Number.isFinite), 1);
  const cells = {};
  Object.keys((data.rows[1] || {}).cells || {}).forEach((c) => {
    cells[c] = { text: '' };
  });
  data.rows[lastRow + 1] = { cells };
  sheet.loadData(data);
}

function toggleAssign() {
  assignOpen.value = !assignOpen.value;
  if (assignOpen.value && !assignStart.value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    assignStart.value = tomorrow.toISOString().split('T')[0];
  }
}

async function onSave() {
  if (!api || !sheet) return;
  const data = sheet.getData();
  const { headers, rows } = fromSheetData(data);
  await api.saveDuty({ headers, rows });
  showToast('值日表已保存');
}

async function onFillNames() {
  if (!api) return;
  const result = await api.fillNames();
  if (result?.changed) {
    showToast('已自动填充姓名');
    await loadDutyTable();
  } else {
    showToast('无需填充');
  }
}

async function onImport() {
  if (!api) return;
  let result;
  try {
    showToast('正在打开文件选择框…');
    result = await api.importDuty();
  } catch (e) {
    showToast('导入失败：' + (e?.message || e));
    return;
  }
  if (result?.success) {
    showToast(result.message);
    await loadDutyTable();
  } else if (result?.message !== '已取消') {
    showToast(result?.message || '导入失败');
  }
}

async function onAssignConfirm() {
  if (!api) return;
  if (!assignStart.value) {
    showToast('请选择起始日期');
    return;
  }
  const result = await api.assignDates({
    startDate: assignStart.value,
    count: assignCount.value || 0,
    skipWeekends: assignSkipWeekend.value,
  });
  showToast(result?.message || '分配完成');
  if (result?.assigned > 0) {
    assignOpen.value = false;
    await loadDutyTable();
  }
}

onMounted(() => {
  sheet = new Spreadsheet(sheetEl.value, {
    showToolbar: true,
    showGrid: true,
    showContextmenu: true,
    view: {
      showRowHeader: true,
      showColHeader: true,
    },
    row: { len: 1000, height: 26 },
    column: { len: 40, width: 96 },
  });
  loadDutyTable();
});

onBeforeUnmount(() => {
  if (sheet) sheet.destroy?.();
  sheet = null;
});
</script>

<style scoped>
.ad-scroll {
  height: 100%;
}

.ad-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 32px 40px;
  min-height: 100%;
  box-sizing: border-box;
}

.ad-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.ad-page-title {
  color: var(--text-primary);
}

.ad-toolbar-actions {
  display: flex;
  gap: 4px;
}

.ad-assign {
  gap: 12px;
}

.ad-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ad-label {
  color: var(--text-secondary);
}

.ad-input {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--control-stroke-color-default);
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--control-color-fill-input);
  color: var(--text-primary);
  font: inherit;
  outline: none;
}

.ad-input:focus {
  border-color: var(--accent-base);
}

.ad-number {
  width: 140px;
}

.ad-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Excel 网格容器：随窗口高度自适应（至少 440px，无上限） */
.ad-sheet {
  flex: 1 1 auto;
  min-height: 440px;
  border: 1px solid var(--card-stroke);
  border-radius: var(--ControlCornerRadius, 4px);
  overflow: hidden;
  background: #fff;
}

/* 深色主题下让网格工具栏/内容区保持亮色（Excel 风格） */
:global(.ad-sheet .x-spreadsheet) {
  background: #fff;
}
</style>
