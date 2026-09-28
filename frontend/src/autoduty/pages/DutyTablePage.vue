<template>
  <ScrollViewer ref="sv" class="ad-scroll" VerticalScrollBarVisibility="Auto" VerticalScrollMode="Auto">
    <div class="ad-page">
      <div class="ad-toolbar">
        <TextBlock class="ad-page-title" Text="值日安排表" FontSize="24" FontWeight="600" />
        <div class="ad-toolbar-actions">
          <Button Style="SubtleButtonStyle" Content="打开本地表格" @Click="onOpenLocal" />
          <Button Style="SubtleButtonStyle" Content="导入 Excel" @Click="onImport" />
          <Button Style="SubtleButtonStyle" Content="分配日期" @Click="onAssignClick" @pointerup="onAssignPointerUp" />
          <Button Style="SubtleButtonStyle" Content="+ 添加行" @Click="addRow" />
        </div>
      </div>

      <Border v-if="assignOpen" class="ad-card ad-assign">
        <div class="ad-field">
          <TextBlock class="ad-label" Text="值日星期（交接日）" FontSize="14" />
          <div class="ad-weekdays">
            <label v-for="w in weekdayOptions" :key="w.v" class="ad-wd">
              <input type="checkbox" :value="w.v" v-model="assignWeekdays" /> {{ w.label }}
            </label>
          </div>
          <TextBlock class="ad-hint" Text="自动从现有日期之后继续，按交接日填满所有未分配行" FontSize="12" />
        </div>
        <div class="ad-row">
          <Button Style="AccentButtonStyle" Content="确认分配" @Click="onAssignConfirmClick" @pointerup="onAssignConfirmPointerUp" />
          <Button Style="DefaultButtonStyle" Content="取消" @Click="onAssignClick" @pointerup="onAssignPointerUp" />
        </div>
      </Border>

      <!-- 触控表格：整表容器内滚动，表头固定，点击单元格直接编辑 -->
      <div class="ad-sheet">
        <TouchTable v-model:rows="dutyRows" :columns="cols" storage-key="duty" />
      </div>

      <div class="ad-row">
        <Button Style="AccentButtonStyle" Content="保存值日表" @Click="onSave" />
        <Button Style="DefaultButtonStyle" Content="自动填充姓名" @Click="onFillNames" />
      </div>
    </div>
  </ScrollViewer>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import ScrollViewer from '@winui/components/ScrollViewer.vue';
import TextBlock from '@winui/components/TextBlock.vue';
import Border from '@winui/components/Border.vue';
import Button from '@winui/components/Button.vue';
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
// 值日星期（交接日）：1=周一 … 7=周日，默认周一至周五
const weekdayOptions = [1, 2, 3, 4, 5, 6, 7].map((v) => ({ v, label: '周' + '一二三四五六日'[v - 1] }));
const assignWeekdays = ref([1, 2, 3, 4, 5]);

async function loadDutyTable() {
  if (!api) return;
  const data = await api.getDutyAll();
  const hdrs = (data?.headers || []).map((h) => String(h ?? ''));
  const w = hdrs.length;
  const rows = (data?.rows || []).map((r) => {
    const arr = (r || []).map((v) => String(v ?? ''));
    while (arr.length < w) arr.push('');
    return arr;
  });
  // 日期列放到 A 列：表头与每行数据同步重排（保存即按此顺序落盘，
  // 主进程按表头名称定位日期列，列位置变化不影响分配/查询逻辑）
  const dateIdx = hdrs.findIndex((h) => /日期|时间/.test(h));
  if (dateIdx > 0) {
    const [dateHdr] = hdrs.splice(dateIdx, 1);
    hdrs.unshift(dateHdr);
    dutyRows.value = rows.map((r) => {
      const arr = r.slice();
      const [dv] = arr.splice(dateIdx, 1);
      arr.unshift(dv ?? '');
      return arr;
    });
  } else {
    dutyRows.value = rows;
  }
  headers.value = hdrs;
}

function addRow() {
  const w = Math.max(cols.value.length, 1);
  dutyRows.value.push(Array(w).fill(''));
}

function toggleAssign() {
  assignOpen.value = !assignOpen.value;
}

// 触屏兜底：click 事件被浏览器吞掉时，由 pointerup 触发切换；
// 300ms 内 click 已处理则忽略，避免正常设备上双击开关
let lastAssignClickAt = 0;
function onAssignClick() {
  lastAssignClickAt = Date.now();
  toggleAssign();
}
function onAssignPointerUp() {
  if (Date.now() - lastAssignClickAt < 300) return;
  toggleAssign();
}

// 确认分配同样加触屏兜底
let lastConfirmAt = 0;
function onAssignConfirmClick() {
  lastConfirmAt = Date.now();
  onAssignConfirm();
}
function onAssignConfirmPointerUp() {
  if (Date.now() - lastConfirmAt < 300) return;
  onAssignConfirm();
}

async function onSave() {
  if (!api) return;
  // ref.value 是响应式 Proxy，无法被 Electron IPC 结构化克隆；
  // 必须展开为普通数组后再传（否则抛 "An object could not be cloned"）
  const result = await api.saveDuty({
    headers: [...headers.value],
    rows: dutyRows.value.map((r) => [...r]),
  });
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

// 用系统默认程序（Excel/WPS）打开 data 目录下的值日表，编辑保存后自动同步
async function onOpenLocal() {
  if (!api) return;
  try {
    const r = await api.openLocalTable('duty');
    showToast(r?.message || (r?.success ? '已打开' : '打开失败'));
  } catch (e) {
    showToast('打开失败：' + (e?.message || e));
  }
}

async function onAssignConfirm() {
  if (!api) return;
  if (assignWeekdays.value.length === 0) {
    showToast('请至少选择一个值日星期');
    return;
  }
  let result;
  try {
    // assignWeekdays.value 是响应式 Proxy，需展开为普通数组后再传 IPC
    result = await api.assignDates({ weekdays: [...assignWeekdays.value] });
  } catch (e) {
    console.error('[assignDates]', e, e?.stack);
    showToast('分配失败：' + (e?.message || e));
    return;
  }
  showToast(result?.message || '分配完成');
  if (result?.assigned > 0) {
    assignOpen.value = false;
    await loadDutyTable();
  }
}

// 外部修改 data 目录表格文件时自动同步（Excel/WPS 保存后立即生效）
// 回调需保持同一引用（on/off 成对），且 off 由 contextBridge 单独暴露
const onTableChanged = () => {
  showToast('检测到表格文件已修改，已同步');
  loadDutyTable();
};

onMounted(() => {
  loadDutyTable();
  if (api?.onDutyExternalChange) api.onDutyExternalChange(onTableChanged);
});

onBeforeUnmount(() => {
  if (api?.offDutyExternalChange) api.offDutyExternalChange(onTableChanged);
});
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

.ad-hint {
  color: var(--text-secondary);
  opacity: 0.8;
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

/* 值日星期复选：胶囊样式，触屏友好 */
.ad-weekdays {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ad-wd {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--control-stroke-color-default);
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--control-color-fill-input);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.ad-wd input {
  margin: 0;
  width: 16px;
  height: 16px;
  accent-color: var(--accent-base, #0067c0);
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
