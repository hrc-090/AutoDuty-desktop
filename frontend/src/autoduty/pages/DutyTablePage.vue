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

      <div class="ad-table-wrap">
        <table class="ad-table">
          <thead>
            <tr>
              <th v-for="h in dutyHeaders" :key="h">{{ h }}</th>
              <th class="ad-th-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, r) in dutyRows" :key="r">
              <td
                v-for="(cell, c) in row" :key="c"
                :class="{ 'ad-date-cell': dutyHeaders[c] && dutyHeaders[c].includes('日期') }"
                contenteditable="true"
                @blur="onCellBlur(r, c, $event)">{{ cell }}</td>
              <td>
                <Button Style="SubtleButtonStyle" Content="删除" @Click="deleteRow(r)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="ad-row">
        <Button Style="AccentButtonStyle" Content="保存值日表" @Click="onSave" />
        <Button Style="DefaultButtonStyle" Content="自动填充姓名" @Click="onFillNames" />
      </div>
    </div>
  </ScrollViewer>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import ScrollViewer from '@winui/components/ScrollViewer.vue';
import TextBlock from '@winui/components/TextBlock.vue';
import Border from '@winui/components/Border.vue';
import Button from '@winui/components/Button.vue';
import ToggleSwitch from '@winui/components/ToggleSwitch.vue';
import { useAutoduty } from '../useAutoduty';
import { showToast } from '../toast';

const api = useAutoduty();
const dutyHeaders = ref([]);
const dutyRows = ref([]);
const assignOpen = ref(false);
const assignStart = ref('');
const assignCount = ref(0);
const assignSkipWeekend = ref(true);

async function loadDutyTable() {
  if (!api) return;
  const data = await api.getDutyAll();
  dutyHeaders.value = data.headers || [];
  dutyRows.value = data.rows || [];
}

function onCellBlur(r, c, e) {
  const value = e.target.textContent.trim();
  dutyRows.value[r][c] = value;
}

function deleteRow(r) {
  dutyRows.value.splice(r, 1);
}

function addRow() {
  dutyRows.value.push(dutyHeaders.value.map(() => ''));
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
  if (!api) return;
  await api.saveDuty({ headers: dutyHeaders.value, rows: dutyRows.value });
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
  const result = await api.importDuty();
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

onMounted(loadDutyTable);
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
  position: sticky;
  top: 0;
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  background: var(--card-bg-secondary);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--card-stroke);
  white-space: nowrap;
}

.ad-table td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--stroke-divider);
  min-width: 40px;
  outline: none;
}

.ad-table td:focus {
  background: var(--ctrl-fill-tertiary);
}

.ad-table tbody tr:hover {
  background: var(--ctrl-fill-secondary);
}

.ad-date-cell {
  font-variant-numeric: tabular-nums;
}

.ad-th-op,
.ad-table td:last-child {
  width: 64px;
  white-space: nowrap;
}
</style>