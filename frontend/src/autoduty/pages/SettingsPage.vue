<template>
  <ScrollViewer class="ad-scroll" VerticalScrollBarVisibility="Auto" VerticalScrollMode="Auto">
    <div class="ad-page">
      <TextBlock class="ad-page-title" Text="设置" FontSize="24" FontWeight="600" />

      <Border class="ad-card">
        <TextBlock class="ad-section-title" Text="通知设置" FontSize="16" FontWeight="600" />

        <div class="ad-field">
          <TextBox Header="API 地址" PlaceholderText="http://localhost:36000/duty" v-model:Text="settings.apiUrl" />
          <TextBlock class="ad-hint" Text="接收值日通知的 API 端点" FontSize="12" />
        </div>

        <div class="ad-field">
          <TextBlock class="ad-label" Text="切换时间（小时）" FontSize="14" />
          <input type="number" class="ad-input ad-number" v-model.number="settings.switchHour" min="0" max="23" />
          <TextBlock class="ad-hint" Text="超过此时间后自动读取次日安排" FontSize="12" />
        </div>

        <ToggleSwitch Header="定时自动发送通知" :IsOn="settings.autoNotify" @update:IsOn="settings.autoNotify = $event" />
      </Border>

      <Border class="ad-card">
        <TextBlock class="ad-section-title" Text="系统设置" FontSize="16" FontWeight="600" />

        <ToggleSwitch Header="开机自启动" :IsOn="settings.autoStart" @update:IsOn="settings.autoStart = $event" />
        <ToggleSwitch Header="启动时隐藏主界面" :IsOn="settings.startHidden" @update:IsOn="settings.startHidden = $event" />
        <ToggleSwitch Header="注册 duty:// URL 协议" :IsOn="settings.registerProtocol" @update:IsOn="settings.registerProtocol = $event" />
      </Border>

      <Border class="ad-card">
        <TextBlock class="ad-section-title" Text="软件更新" FontSize="16" FontWeight="600" />

        <TextBlock class="ad-hint" Text="更新源：GitHub Releases（hrc-090/AutoDuty-desktop）" FontSize="12" />

        <ToggleSwitch Header="启动时自动检查更新" :IsOn="settings.autoUpdate" @update:IsOn="settings.autoUpdate = $event" />

        <TextBlock class="ad-label" Text="当前版本" FontSize="14" />
        <TextBlock class="ad-version" :Text="currentVersion" FontSize="14" />

        <TextBlock class="ad-update-result" :Text="updateResult" FontSize="14" :MaxLines="6" />

        <div class="ad-row">
          <Button Style="DefaultButtonStyle" Content="检查更新" @Click="onCheckUpdate" />
          <Button v-if="updateUrl" Style="AccentButtonStyle" Content="下载更新" @Click="onDownloadUpdate" />
        </div>
      </Border>

      <Button Style="AccentButtonStyle" Content="保存设置" @Click="onSave" />
    </div>
  </ScrollViewer>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import ScrollViewer from '@winui/components/ScrollViewer.vue';
import TextBlock from '@winui/components/TextBlock.vue';
import Border from '@winui/components/Border.vue';
import Button from '@winui/components/Button.vue';
import ToggleSwitch from '@winui/components/ToggleSwitch.vue';
import TextBox from '@winui/components/TextBox.vue';
import { useAutoduty } from '../useAutoduty';
import { showToast } from '../toast';

const api = useAutoduty();
const settings = reactive({
  apiUrl: '',
  switchHour: 18,
  autoNotify: true,
  autoStart: false,
  startHidden: false,
  registerProtocol: true,
  autoUpdate: true,
});
const currentVersion = ref('-');
const updateResult = ref('');
const updateUrl = ref('');

async function loadSettings() {
  if (!api) return;
  const config = await api.getConfig();
  if (!config) return;
  settings.apiUrl = config.apiUrl || '';
  settings.switchHour = config.switchHour;
  settings.autoNotify = config.autoNotify;
  settings.autoStart = config.autoStart;
  settings.startHidden = config.startHidden;
  settings.registerProtocol = config.registerProtocol;
  settings.autoUpdate = config.autoUpdate;
  currentVersion.value = config.currentVersion || '-';
}

async function onSave() {
  if (!api) return;
  await api.setConfig({
    apiUrl: settings.apiUrl.trim(),
    switchHour: parseInt(settings.switchHour, 10),
    autoNotify: settings.autoNotify,
    autoStart: settings.autoStart,
    startHidden: settings.startHidden,
    registerProtocol: settings.registerProtocol,
    autoUpdate: settings.autoUpdate,
  });
  showToast('设置已保存');
}

async function onCheckUpdate() {
  if (!api) return;
  const r = await api.checkUpdate(true);
  renderUpdateResult(r);
}

async function onDownloadUpdate() {
  if (!api || !updateUrl.value) return;
  const res = await api.downloadUpdate(updateUrl.value);
  if (res?.success) {
    showToast(`更新包已下载：${res.path}`);
  } else {
    showToast(res?.message || '下载失败');
  }
}

function renderUpdateResult(r) {
  updateUrl.value = '';
  if (!r) {
    updateResult.value = '';
    return;
  }
  if (r.error) {
    updateResult.value = r.error;
    return;
  }
  if (r.hasUpdate && r.latest) {
    let text = `发现新版本 v${r.latest}（当前 v${r.current}）`;
    if (r.note) text += `\n${r.note}`;
    updateResult.value = text;
    if (r.url) updateUrl.value = r.url;
  } else if (r.latest) {
    updateResult.value = `已是最新版本 v${r.latest}`;
  } else {
    updateResult.value = '暂无可用更新';
  }
}

onMounted(loadSettings);
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
  max-width: 760px;
}

.ad-page-title {
  color: var(--text-primary);
}

.ad-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
}

.ad-section-title {
  color: var(--text-primary);
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
  color: var(--text-tertiary);
}

.ad-version {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.ad-update-result {
  color: var(--accent-base);
  white-space: pre-wrap;
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
  gap: 8px;
}
</style>