<template>
  <ScrollViewer ref="sv" class="ad-scroll" VerticalScrollBarVisibility="Auto" VerticalScrollMode="Auto">
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

      <!-- 触控表格：整表容器内滚动，表头固定，点击单元格直接编辑 -->
      <div class="ad-sheet">
        <TouchTable v-model:rows="dutyRows" :columns="cols" />
      </div>

      <div class="ad-row">
        <Button Style="AccentButtonStyle" Content="保存值日表" @Click="onSave" />
        <Button Style="DefaultButtonStyle" Content="自动填充姓名" @Click="onFillNames" />
      </div>
    </div>
  </ScrollViewer>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import ScrollViewer from '@winui/components/ScrollViewer.vue';
import TextBlock from '@winui/components/TextBlock.vue';
import Border from '@winui/components/Border.vue';
import Button from '@winui/components/Button.vue';
import ToggleSwitch from '@winui/components/ToggleSwitch.vue';
import TouchTable from '../TouchTable.vue';
import { useAutoduty } from '../useAutoduty';
import { showToast } from '../toast';

const api = useAutoduty();

// 表格数据：表头与行分离，行保持纯字符串数组（与 xlsx 读写格式一致）
const headers = ref([]);
const dutyRows = ref([]);

// 表头含「日期/时间」的列使用日期编辑（文本输入 + 日历按钮）
const cols = computed(() =>
  (headers.value || []).map((h) => ({
    label: String(h ?? ''),
    type: /日期|时间/.test(String(h ?? '')) ? 'date' : 'text',
  }))
);

const assignOpen = ref(false);
const assignStart = ref('');
const assignCount = ref(0);
const assignSkipWeekend = ref(true);

async function loadDutyTable() {
  if (!api) return;
  const data = await api.getDutyAll();
  headers.value = (data?.headers || []).map((h) => String(h ?? ''));
  const w = headers.value.length;
  dutyRows.value = (data?.rows || []).map((r) => {
    const arr = (r || []).map((v) => String(v ?? ''));
    while (arr.length < w) arr.push('');
    return arr;
  });
}

function addRow() {
  const w = Math.max(cols.value.length, 1);
  dutyRows.value.push(Array(w).fill(''));
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
  const result = await api.saveDuty({ headers: headers.value, rows: dutyRows.value });
  if (result?.success === false) {
    showToast('保存失败：' + (result.message || '未知错误'));
    return;
  }
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

onMounted(loadDutyTable);
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
