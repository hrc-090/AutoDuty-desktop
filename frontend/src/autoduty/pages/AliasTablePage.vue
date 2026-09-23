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

      <div class="ad-table-wrap">
        <table class="ad-table">
          <thead>
            <tr>
              <th>中文名</th>
              <th>别名</th>
              <th class="ad-th-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, idx) in aliasData" :key="idx">
              <td contenteditable="true" @blur="onCellBlur(idx, 'name', $event)">{{ entry.name }}</td>
              <td contenteditable="true" @blur="onCellBlur(idx, 'alias', $event)">{{ entry.alias }}</td>
              <td>
                <Button Style="SubtleButtonStyle" Content="删除" @Click="deleteRow(idx)" />
              </td>
            </tr>
          </tbody>
        </table>
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
import { useAutoduty } from '../useAutoduty';
import { showToast } from '../toast';

const api = useAutoduty();
const aliasData = ref([]);

async function loadAliasTable() {
  if (!api) return;
  aliasData.value = await api.getAliasAll();
}

function onCellBlur(idx, field, e) {
  aliasData.value[idx][field] = e.target.textContent.trim();
}

function deleteRow(idx) {
  aliasData.value.splice(idx, 1);
}

function addRow() {
  aliasData.value.push({ name: '', alias: '' });
}

async function onSave() {
  if (!api) return;
  await api.saveAlias(aliasData.value);
  showToast('别名表已保存');
}

async function onImport() {
  if (!api) return;
  const result = await api.importAlias();
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

.ad-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 32px 40px;
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

.ad-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--card-stroke);
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--card-bg);
}

.ad-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  color: var(--text-primary);
}

.ad-table th {
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  background: var(--card-bg-secondary);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--card-stroke);
}

.ad-table td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--stroke-divider);
  outline: none;
}

.ad-table td:focus {
  background: var(--ctrl-fill-tertiary);
}

.ad-table tbody tr:hover {
  background: var(--ctrl-fill-secondary);
}

.ad-th-op,
.ad-table td:last-child {
  width: 64px;
  white-space: nowrap;
}

.ad-row {
  display: flex;
  gap: 8px;
}
</style>