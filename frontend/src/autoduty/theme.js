// 主题控制：'system' | 'light' | 'dark'
// WinUIonWeb 的 token 定义在 html.theme-light / html.theme-dark 两个类上，
// 见 @winui/styles/theme.css。system 模式监听 prefers-color-scheme；
// 该媒体查询会跟随主进程 nativeTheme.themeSource（设置页切换主题后主进程同步更新）。
let mq = null;
let current = 'system';

function setMode(dark) {
  const el = document.documentElement;
  el.classList.toggle('theme-dark', dark);
  el.classList.toggle('theme-light', !dark);
}

function onMediaChange(e) {
  if (current === 'system') setMode(e.matches);
}

// 应用主题：light/dark 直接强制类名；system 跟随系统并监听变化
export function applyTheme(theme) {
  current = theme === 'light' || theme === 'dark' ? theme : 'system';
  if (mq) {
    mq.removeEventListener('change', onMediaChange);
    mq = null;
  }
  if (current === 'system') {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onMediaChange);
    setMode(mq.matches);
  } else {
    setMode(current === 'dark');
  }
}

// 启动时读取配置中的主题并应用（调用方无需等待）
export async function initTheme() {
  let theme = 'system';
  try {
    if (typeof window !== 'undefined' && window.autoduty && window.autoduty.getConfig) {
      const config = await window.autoduty.getConfig();
      if (config && config.theme) theme = config.theme;
    }
  } catch (e) {}
  applyTheme(theme);
}

export function getTheme() {
  return current;
}
