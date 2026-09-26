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

      <!-- 触控表格：整表容器内滚动，表头固定，点击单元格直接编辑 -->
      <div class="ad-sheet">
        <TouchTable v-model:rows="aliasRows" :columns="cols" />
      </div>

      <div class="ad-row">
        <Button Style="AccentButtonStyle" Content="保存别名表" @Click="onSave" />
      </div>
    </div>
  </ScrollViewer>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import ScrollViewer from '@winui/components/ScrollViewer.vue';
import TextBlock from '@winui/components/TextBlock.vue';
import Button from '@winui/components/Button.vue';
import TouchTable from '../TouchTable.vue';
import { useAutoduty } from '../useAutoduty';
import { showToast } from '../toast';

const api = useAutoduty();

// 别名表固定两列：中文名 / 别名（行 = [name, alias]）
const cols = [
  { label: '中文名', type: 'text', placeholder: '如 张三' },
  { label: '别名', type: 'text', placeholder: '如 zhang' },
];
const aliasRows = ref([]);

async function loadAliasTable() {
  if (!api) return;
  const entries = await api.getAliasAll();
  aliasRows.value = (entries || []).map((e) => [
    String(e?.name ?? ''),
    String(e?.alias ?? ''),
  ]);
}

function addRow() {
  aliasRows.value.push(['', '']);
}

async function onSave() {
  if (!api) return;
  const entries = aliasRows.value.map((r) => ({ name: r[0] || '', alias: r[1] || '' }));
  const result = await api.saveAlias(entries);
  if (result?.success === false) {
    showToast('保存失败：' + (result.message || '未知错误'));
    return;
  }
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

onMounted(loadAliasTable);
</script>

<style scoped>
.ad-scroll {
  height: 100%;
}

/* 自适应窗口：本页 ScrollViewer 的滚动内容高度设为视口高度（覆盖上游
   .scroll-content 的 min-height:max-content），使 .ad-page 的百分比高度可解析，
   .ad-sheet 的 flex:1 才能随窗口缩放填充剩余空间 */
:global(.ad-scroll .win-scroll-viewer-viewport .scroll-content) {
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

/* 表格容器：占满工具栏/按钮之间的剩余高度，且不小于视口的 55%（触屏大屏体验） */
.ad-sheet {
  flex: 1 1 0;
  min-height: 55vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--card-stroke);
  border-radius: var(--ControlCornerRadius, 4px);
  overflow: hidden;
}
</style>
