<template>
  <ScrollViewer class="ad-scroll" VerticalScrollBarVisibility="Auto" VerticalScrollMode="Auto">
    <div class="ad-page">
      <div class="ad-toolbar">
        <TextBlock class="ad-page-title" Text="别名映射表" FontSize="24" FontWeight="600" />
        <div class="ad-toolbar-actions">
          <Button Style="SubtleButtonStyle" Content="导入 Excel" @Click="onImport" />
          <Button Style="SubtleButtonStyle" Content="+ 添加行" @Click="addRow" />
        </div>
      </div>

      <!-- Excel 风格网格 -->
      <div class="ad-sheet" ref="sheetEl"></div>

      <div class="ad-row">
        <Button Style="AccentButtonStyle" Content="保存别名表" @Click="onSave" />
      </div>
    </div>
  </ScrollViewer>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import ScrollViewer from '@winui/components/ScrollViewer.vue';
import TextBlock from '@winui/components/TextBlock.vue';
import Button from '@winui/components/Button.vue';
import Spreadsheet from 'x-data-spreadsheet/src/index';
import 'x-data-spreadsheet/dist/xspreadsheet.css';
import zhCN from '../xspreadsheet-zh';
import { useAutoduty } from '../useAutoduty';
import { showToast } from '../toast';

Spreadsheet.locale('zh-cn', zhCN);

const api = useAutoduty();
const sheetEl = ref(null);
let sheet = null;

// 别名表 entries [{name, alias}] → x-spreadsheet 数据（首行固定表头）
function toSheetData(entries) {
  const data = { rows: {} };
  data.rows[1] = {
    cells: {
      1: { text: '中文名' },
      2: { text: '别名' },
    },
  };
  (entries || []).forEach((entry, r) => {
    const cells = {};
    const name = String(entry.name ?? '');
    const alias = String(entry.alias ?? '');
    if (name) cells[1] = { text: name };
    if (alias) cells[2] = { text: alias };
    data.rows[r + 2] = { cells };
  });
  return data;
}

// x-spreadsheet 数据 → entries [{name, alias}]
function fromSheetData(data) {
  const entries = [];
  const rowKeys = Object.keys(data.rows || {})
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  rowKeys.forEach((r) => {
    if (r <= 1) return;
    const cells = (data.rows[r] || {}).cells || {};
    entries.push({
      name: (cells[1] || {}).text ?? '',
      alias: (cells[2] || {}).text ?? '',
    });
  });
  return entries;
}

async function loadAliasTable() {
  if (!api || !sheet) return;
  const entries = await api.getAliasAll();
  sheet.loadData(toSheetData(entries));
}

function addRow() {
  if (!sheet) return;
  const data = sheet.getData();
  const lastRow = Math.max(...Object.keys(data.rows || {}).map(Number).filter(Number.isFinite), 1);
  data.rows[lastRow + 1] = { cells: { 1: { text: '' }, 2: { text: '' } } };
  sheet.loadData(data);
}

async function onSave() {
  if (!api || !sheet) return;
  const data = sheet.getData();
  await api.saveAlias(fromSheetData(data));
  showToast('别名表已保存');
}

async function onImport() {
  if (!api) return;
  let result;
  try {
    showToast('正在打开文件选择框…');
    result = await api.importAlias();
  } catch (e) {
    showToast('导入失败：' + (e?.message || e));
    return;
  }
  if (result?.success) {
    showToast(result.message);
    await loadAliasTable();
  } else if (result?.message !== '已取消') {
    showToast(result?.message || '导入失败');
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
    column: { len: 40, width: 140 },
  });
  loadAliasTable();
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

:global(.ad-sheet .x-spreadsheet) {
  background: #fff;
}
</style>
