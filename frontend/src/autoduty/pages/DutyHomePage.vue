<template>
  <ScrollViewer class="ad-scroll" VerticalScrollBarVisibility="Auto" VerticalScrollMode="Auto">
    <div class="ad-page">
      <TextBlock class="ad-page-title" Text="首页" FontSize="24" FontWeight="600" />

      <Border class="ad-card">
        <TextBlock class="ad-label" Text="目标日期" FontSize="14" />
        <div class="ad-row">
          <input type="date" class="ad-input ad-date" v-model="manualDate" />
          <Button Style="AccentButtonStyle" Content="查询" @Click="loadHome" />
        </div>
        <TextBlock class="ad-hint" Text="留空则按切换时间自动判断" FontSize="12" />
      </Border>

      <Border class="ad-card">
        <TextBlock class="ad-label" Text="值日安排" FontSize="14" />
        <TextBlock class="ad-duty" :Text="dutyText" FontSize="18" FontWeight="600" :MaxLines="6" />
      </Border>

      <Border class="ad-card">
        <TextBlock class="ad-label" Text="上次执行" FontSize="14" />
        <TextBlock class="ad-last" :Text="homeState.last" FontSize="14" :MaxLines="4" />
      </Border>

      <Button Style="AccentButtonStyle" Content="立即执行" :IsEnabled="!homeState.executing" @Click="onExecute" />
    </div>
  </ScrollViewer>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import ScrollViewer from '@winui/components/ScrollViewer.vue';
import TextBlock from '@winui/components/TextBlock.vue';
import Border from '@winui/components/Border.vue';
import Button from '@winui/components/Button.vue';
import { useAutoduty } from '../useAutoduty';
import { homeState } from '../state';

const api = useAutoduty();
const manualDate = ref('');
const dutyText = ref('--');

async function loadHome() {
  if (!api) return;
  let preview;
  if (manualDate.value) {
    preview = await api.previewDutyDate(manualDate.value);
  } else {
    preview = await api.previewDuty();
  }
  dutyText.value = preview?.dutyText || '无值日安排（未分配日期或当天无数据）';
}

async function onExecute() {
  if (!api || homeState.executing) return;
  homeState.executing = true;
  await api.executeDuty();
}

// duty result 到达后刷新安排
watch(() => homeState.tick, loadHome);

onMounted(loadHome);
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
  max-width: 860px;
}

.ad-page-title {
  color: var(--text-primary);
}

.ad-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
}

.ad-label {
  color: var(--text-secondary);
}

.ad-duty {
  color: var(--text-primary);
  white-space: pre-wrap;
}

.ad-last {
  color: var(--text-secondary);
}

.ad-hint {
  color: var(--text-tertiary);
}

.ad-row {
  display: flex;
  align-items: center;
  gap: 8px;
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

.ad-date {
  flex: 1;
  min-width: 0;
}
</style>