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

        <div class="ad-field">
          <TextBlock class="ad-label" Text="外观主题" FontSize="14" />
          <select class="ad-input ad-select" :value="settings.theme" @change="onThemeChange">
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>
      </Border>

      <Border class="ad-card">
        <TextBlock class="ad-section-title" Text="软件更新" FontSize="16" FontWeight="600" />

        <TextBlock class="ad-hint" Text="更新源：GitHub Releases（hrc-090/AutoDuty-desktop）" FontSize="12" />

        <ToggleSwitch Header="启动时自动检查更新" :IsOn="settings.autoUpdate" @update:IsOn="settings.autoUpdate = $event" />

        <div class="ad-field">
          <TextBlock class="ad-label" Text="GitHub 加速节点" FontSize="14" />
          <select class="ad-input ad-select" v-model="settings.updateProxy">
            <option value="">自动测速（下载时自动选择最快节点）</option>
            <option value="direct">直连（不使用加速）</option>
            <option v-for="n in proxyNodes" :key="n.url" :value="n.url">{{ n.label }}</option>
          </select>
          <TextBlock class="ad-hint" Text="加速节点来自 github-proxy 镜像列表，用于加速更新包下载" FontSize="12" />
          <div class="ad-row">
            <Button Style="DefaultButtonStyle" Content="节点测速" @Click="onTestSpeed" :IsEnabled="!speedTesting" />
          </div>
          <TextBlock v-if="speedTesting" class="ad-hint" Text="正在测速，最多约 8 秒…" FontSize="12" />
          <div v-else-if="speedResults.length" class="ad-speed-list">
            <div v-for="(r, i) in speedResults" :key="r.url || 'direct'" class="ad-speed-item">
              <span class="ad-speed-rank">{{ i + 1 }}</span>
              <span class="ad-speed-name">{{ r.label }}</span>
              <span class="ad-speed-value" :class="r.ok ? 'is-ok' : 'is-bad'">
                {{ r.ok ? (r.speed / 1048576).toFixed(2) + ' MB/s' : '不可用' }}
              </span>
            </div>
          </div>
        </div>

        <TextBlock class="ad-label" Text="当前版本" FontSize="14" />
        <TextBlock class="ad-version" :Text="currentVersion" FontSize="14" />

        <TextBlock class="ad-update-result" :Text="updateResult" FontSize="14" :MaxLines="6" />

        <div class="ad-row">
          <Button Style="DefaultButtonStyle" Content="检查更新" @Click="onCheckUpdate" />
          <Button v-if="updateUrl && downloadState !== 'done'" Style="AccentButtonStyle" Content="下载更新" @Click="onDownloadUpdate" />
          <Button v-if="downloadState === 'done'" Style="AccentButtonStyle" Content="立即安装" @Click="onInstallUpdate" />
        </div>

        <div v-if="downloadState === 'downloading'" class="ad-download">
          <ProgressBar :Value="downloadProgress" Maximum="100" MinHeight="4" />
          <TextBlock class="ad-hint" :Text="`正在下载更新包… ${downloadProgress}%`" FontSize="12" />
          <div class="ad-row">
            <Button Style="DefaultButtonStyle" Content="取消下载" @Click="onCancelDownload" />
          </div>
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
import ProgressBar from '@winui/components/ProgressBar.vue';
import ToggleSwitch from '@winui/components/ToggleSwitch.vue';
import TextBox from '@winui/components/TextBox.vue';
import { useAutoduty } from '../useAutoduty';
import { showToast } from '../toast';
import { applyTheme } from '../theme';

const api = useAutoduty();
const settings = reactive({
  apiUrl: '',
  switchHour: 18,
  autoNotify: true,
  autoStart: false,
  startHidden: false,
  registerProtocol: true,
  autoUpdate: true,
  updateProxy: '',
  theme: 'system',
});
const currentVersion = ref('-');
const updateResult = ref('');
const updateUrl = ref('');
const downloadState = ref('idle'); // idle | downloading | done | error
const downloadProgress = ref(0);
const downloadedPath = ref('');
const proxyNodes = ref([]);
const speedResults = ref([]);
const speedTesting = ref(false);

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
  settings.updateProxy = config.updateProxy || '';
  settings.theme = config.theme || 'system';
  currentVersion.value = config.currentVersion || '-';
}

async function loadProxyList() {
  if (!api) return;
  try {
    const list = await api.getProxyList();
    proxyNodes.value = Array.isArray(list) ? list : [];
  } catch (e) {
    proxyNodes.value = [];
  }
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
    updateProxy: settings.updateProxy,
    theme: settings.theme,
  });
  applyTheme(settings.theme);
  showToast('设置已保存');
}

// 主题仅在用户手动选择时即时生效（加载配置/打开设置页不触发主题切换）
function onThemeChange(e) {
  const v = e.target.value;
  settings.theme = v;
  if (v) applyTheme(v);
}

async function onCheckUpdate() {
  if (!api) return;
  const r = await api.checkUpdate(true);
  renderUpdateResult(r);
}

async function onDownloadUpdate() {
  if (!api || !updateUrl.value) return;
  downloadState.value = 'downloading';
  downloadProgress.value = 0;
  const res = await api.downloadUpdate(updateUrl.value);
  if (res?.success) {
    downloadState.value = 'done';
    downloadedPath.value = res.path;
    showToast(`更新包已下载：${res.path}`);
  } else {
    downloadState.value = 'error';
    showToast(res?.message || '下载失败');
  }
}

async function onCancelDownload() {
  if (!api) return;
  const r = await api.cancelDownload();
  showToast(r?.success ? '正在取消下载…' : (r?.message || '取消失败'));
}

async function onTestSpeed() {
  if (!api) return;
  speedTesting.value = true;
  speedResults.value = [];
  try {
    const res = await api.testProxySpeed(updateUrl.value || '');
    speedResults.value = Array.isArray(res) ? res : [];
  } catch (e) {
    speedResults.value = [];
    showToast('测速失败：' + (e?.message || e));
  } finally {
    speedTesting.value = false;
  }
}

async function onInstallUpdate() {
  if (!api || !downloadedPath.value) return;
  const res = await api.installUpdate(downloadedPath.value);
  showToast(res?.message || (res?.success ? '正在启动安装…' : '启动安装失败'));
}

function onUpdateProgress(info) {
  if (info && typeof info.percent === 'number' && info.percent >= 0) {
    downloadProgress.value = info.percent;
  }
}

function renderUpdateResult(r) {
  updateUrl.value = '';
  downloadState.value = 'idle';
  downloadProgress.value = 0;
  downloadedPath.value = '';
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

onMounted(() => {
  loadSettings();
  loadProxyList();
  if (api?.onUpdateProgress) api.onUpdateProgress(onUpdateProgress);
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

.ad-select {
  max-width: 420px;
  height: 38px;
  cursor: pointer;
}

.ad-speed-list {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--card-stroke);
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--card-bg-secondary);
}

.ad-speed-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--card-stroke);
  font-size: 13px;
}

.ad-speed-item:last-child {
  border-bottom: none;
}

.ad-speed-rank {
  width: 22px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.ad-speed-name {
  flex: 1;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ad-speed-value {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ad-speed-value.is-ok {
  color: var(--accent-base);
}

.ad-speed-value.is-bad {
  color: var(--text-disabled);
}

.ad-number {
  width: 140px;
}

.ad-row {
  display: flex;
  gap: 8px;
}

.ad-download {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>