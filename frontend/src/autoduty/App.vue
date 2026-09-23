<template>
  <div class="ad-shell">
    <TitleBar
      Title="AutoDuty"
      Subtitle="值日提醒"
      PreferredHeightOption="Tall"
      :IconSource="{ Glyph: '\uE816' }">
    </TitleBar>

    <NavigationView
      v-model:SelectedItem="selectedNav"
      :MenuItems="navMenuItems"
      :IsSettingsVisible="false"
      :IsPaneToggleButtonVisible="false"
      PaneTitle="AutoDuty"
      PaneDisplayMode="Left"
      :OpenPaneLength="216"
      @ItemInvoked="onItemInvoked">
      <main class="ad-content">
        <component :is="currentComponent" />
      </main>
    </NavigationView>

    <Teleport to="body">
      <Transition name="ad-toast">
        <div v-if="toastState.visible" class="ad-toast">{{ toastState.text }}</div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, onMounted } from 'vue';
import TitleBar from '@winui/components/TitleBar.vue';
import NavigationView from '@winui/components/NavigationView.vue';
import DutyHomePage from './pages/DutyHomePage.vue';
import DutyTablePage from './pages/DutyTablePage.vue';
import AliasTablePage from './pages/AliasTablePage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import { autodutyApi as api } from './useAutoduty';
import { toastState, showToast } from './toast';
import { homeState } from './state';

const navMenuItems = [
  { Tag: 'home', Icon: '\uE80F', Content: '首页' },
  { Tag: 'duty', Icon: '\uE8FD', Content: '值日表' },
  { Tag: 'alias', Icon: '\uE8D2', Content: '别名表' },
  { Tag: 'settings', Icon: '\uE713', Content: '设置' },
];

const pages = {
  home: DutyHomePage,
  duty: DutyTablePage,
  alias: AliasTablePage,
  settings: SettingsPage,
};

const current = ref('home');
const currentComponent = shallowRef(pages.home);
const selectedNav = ref(navMenuItems[0]);

function onItemInvoked(evt) {
  // NavigationView 的 ItemInvoked payload：{ InvokedItem, InvokedItemContainer, ... }
  // InvokedItemContainer 是原始菜单项（source），Tag 字段为大写 Tag / Value / Name / value
  const src = evt?.InvokedItemContainer;
  const tag = src?.Tag ?? src?.tag ?? src?.Value ?? src?.value;
  if (tag && pages[tag]) {
    current.value = tag;
    currentComponent.value = pages[tag];
  }
}

onMounted(() => {
  // 统一监听一次值日执行结果，写入共享状态 + Toast
  if (api && typeof api.onDutyResult === 'function') {
    api.onDutyResult((result) => {
      const msg = result?.success
        ? `✅ ${result.message}`
        : `❌ ${result?.message ?? '执行失败'}`;
      homeState.last = msg;
      homeState.executing = false;
      homeState.tick += 1;
      showToast(msg, 4000);
    });
  }
  if (api && typeof api.onUpdateAvailable === 'function') {
    api.onUpdateAvailable((info) => {
      if (info && info.hasUpdate) {
        showToast(`发现新版本 v${info.latest}，请到「设置 → 软件更新」查看`, 5000);
      }
    });
  }
});
</script>

<style scoped>
:global(html, body, #app) {
  height: 100%;
  margin: 0;
}

.ad-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

:deep(.win-nav-shell) {
  flex: 1;
  min-height: 0;
  height: auto;
}

.ad-content {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.ad-toast {
  position: fixed;
  top: 56px;
  right: 16px;
  z-index: 9999;
  max-width: 360px;
  padding: 12px 16px;
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--layer-default);
  border: 1px solid var(--card-stroke);
  border-left: 3px solid var(--accent-base);
  box-shadow: var(--flyout-shadow, 0 8px 24px rgba(0, 0, 0, 0.18));
  color: var(--text-primary);
  font-size: 14px;
  line-height: 20px;
  word-break: break-word;
}

.ad-toast-enter-active,
.ad-toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.ad-toast-enter-from,
.ad-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>