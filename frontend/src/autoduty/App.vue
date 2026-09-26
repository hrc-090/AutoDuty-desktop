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
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue';
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
  // Tag 不能用 'settings'：组件 resolveSelectedValue 会把 Tag==='settings' 的对象
  // 直接解析为内置设置项（字符串 'settings'），导致受控选中链路拿不到 nvi-N 值，
  // itemRefs 查找失败、蓝条指示器不移动。改用非保留值 'prefs'。
  { Tag: 'prefs', Icon: '\uE713', Content: '设置' },
];

const pages = {
  home: DutyHomePage,
  duty: DutyTablePage,
  alias: AliasTablePage,
  prefs: SettingsPage,
};

const current = ref('home');
const currentComponent = shallowRef(pages.home);
// SelectedItem 必须对象受控：组件 emit update:SelectedItem 会回传原始菜单项对象
// （引用与 flattened item.source 一致），内部 resolveSelectedValue 才能解析出
// nvi-N 值并移动蓝条指示器；字符串受控会收到 Tag 字符串导致指示器失配
const selectedNav = ref(navMenuItems[0]);

function switchPage(tag) {
  if (tag && pages[tag]) {
    current.value = tag;
    currentComponent.value = pages[tag];
  }
}

function onItemInvoked(evt) {
  // NavigationView 的 ItemInvoked payload：{ InvokedItem, InvokedItemContainer, ... }
  // InvokedItemContainer 是原始菜单项（source），Tag 字段为大写 Tag / Value / Name / value
  const src = evt?.InvokedItemContainer;
  const tag = src?.Tag ?? src?.tag ?? src?.Value ?? src?.value;
  switchPage(tag);
}

// ---- 触屏兜底：某些触屏环境 NavigationView 的 click 合成可能失效，----
// ---- 用 pointerdown/up + 位移判定模拟点击，拖动滚动不算点击 ----
let navPointerDown = null;
function onNavPointerDown(e) {
  navPointerDown = { x: e.clientX, y: e.clientY };
}
function onNavPointerUp(e) {
  if (!navPointerDown) return;
  const dx = e.clientX - navPointerDown.x;
  const dy = e.clientY - navPointerDown.y;
  navPointerDown = null;
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return; // 滚动/拖动，忽略
  const el = e.target && typeof e.target.closest === 'function'
    ? e.target.closest('.win-nav-item')
    : null;
  if (!el) return;
  // 触屏下 click 可能不被浏览器合成：手动分发 click，让 NavigationView
  // 内部完整链路（选中态 + 蓝条指示 + ItemInvoked）全部走正常逻辑
  el.click();
}

onMounted(() => {
  document.addEventListener('pointerdown', onNavPointerDown, true);
  document.addEventListener('pointerup', onNavPointerUp, true);
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

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onNavPointerDown, true);
  document.removeEventListener('pointerup', onNavPointerUp, true);
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

/* 内容区从 48px 标题栏下方开始，避免页面顶部工具栏（右上方按钮）被原生窗口管理按钮遮挡 */
:deep(.win-nav-content-inner) {
  padding-top: 48px !important;
}

/* 标题栏右侧预留约 138px 给原生窗口管理按钮（env(titlebar-area-width) 不可用时的兜底） */
:deep(.win-titlebar) {
  width: calc(100% - 138px) !important;
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