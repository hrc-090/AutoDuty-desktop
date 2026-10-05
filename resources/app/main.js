/**
 * main.js - Electron 主进程
 */

const electron = require('electron');
const { app, BrowserWindow, Tray, Menu, dialog, shell, net, nativeTheme } = electron;
const ipcMain = electron.ipcMain;
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync, execFile } = require('child_process');
const Store = require('electron-store');
const dutyCore = require('./duty-core');

const CURRENT_VERSION = require('./package.json').version;

// ==================== URL 协议注册 ====================

const PROTOCOL = 'duty';

// 注册 duty:// 协议
app.setAsDefaultProtocolClient(PROTOCOL);

// 处理从 URL 协议启动的参数
function handleProtocolUrl(url) {
  if (!url) return;
  const parsed = new URL(url);
  // duty://send → 执行值日通知
  if (parsed.hostname === 'send') {
    executeDuty();
  }
  // duty://show → 显示主界面
  else if (parsed.hostname === 'show') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

// Windows: 应用已运行时，通过 second-instance 事件接收 URL
app.on('second-instance', (_, commandLine) => {
  const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
  if (url) {
    handleProtocolUrl(url);
  }
  // 只有非 URL 协议启动时才自动显示窗口
  if (!url) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
});

// macOS: 通过 open-url 事件接收
app.on('open-url', (_, url) => {
  handleProtocolUrl(url);
});

const store = new Store({
  name: 'autoduty-config',
  defaults: {
    apiUrl: '',
    switchHour: 18,
    autoNotify: true,
    autoStart: false,
    startHidden: false,
    registerProtocol: true,
    autoUpdate: true,
    updateProxy: '', // GitHub 加速节点：''=自动测速 | 'direct'=直连 | 具体节点 url
    theme: 'system', // 'system' | 'light' | 'dark'
    dutyTemplate: '', // 值日通知内容模板，如「今日值日生：{姓名}」，空=自动拼接
  },
});

// 安装版旧数据目录（exe 旁 /data）→ userData 的迁移标志，避免重复扫描
let legacyMigrated = false;

// 数据目录：安装版使用 userData（AppData\Roaming\AutoDuty），
// 避免 Program Files 只读权限导致保存失败；开发版用项目内 data 目录。
function getDataDir() {
  if (app.isPackaged) {
    const dir = app.getPath('userData');
    if (!legacyMigrated) {
      legacyMigrated = true;
      fs.mkdirSync(dir, { recursive: true });
      migrateLegacyData(dir);
    }
    return dir;
  }
  return path.join(__dirname, 'data');
}

// 将安装版旧位置（exe 旁 /data）的表格数据复制到新数据目录，仅补缺不覆盖
function migrateLegacyData(dir) {
  try {
    const legacy = path.join(path.dirname(app.getPath('exe')), 'data');
    if (legacy === dir || !fs.existsSync(legacy)) return;
    for (const name of ['值日表.xlsx', 'aliases.xlsx']) {
      const src = path.join(legacy, name);
      const dst = path.join(dir, name);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
  } catch (e) {
    // 迁移失败不影响启动，数据目录仍可用
  }
}

// ==================== 数据目录文件监听（外部修改自动同步） ====================
// 用户直接修改 data 目录下的 值日表.xlsx / aliases.xlsx（如 Excel/WPS）后，
// 通知渲染进程刷新对应表格；应用自身保存（duty-core notifySelfWrite）写入被忽略。
let lastSelfWrite = 0;
let tableWatcher = null;
let syncTimer = null;

dutyCore.setOnSelfWrite(() => { lastSelfWrite = Date.now(); });

function setupTableWatcher() {
  const dir = getDataDir();
  try {
    if (tableWatcher) {
      try { tableWatcher.close(); } catch (e) {}
      tableWatcher = null;
    }
    if (!fs.existsSync(dir)) return;
    tableWatcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
      const name = String(filename || '');
      if (name !== '值日表.xlsx' && name !== 'aliases.xlsx') return;
      if (Date.now() - lastSelfWrite < 1500) return;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('duty:externalChange', {});
        }
      }, 800);
    });
  } catch (e) {
    // 监听失败不影响应用运行，表格仍在打开页面时读取最新内容
  }
}

// ==================== 开机自启动 ====================

function updateAutoStart(enable) {
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: app.getPath('exe'),
    args: enable ? ['--hidden'] : [],
  });
}

// ==================== URL 协议注册管理 ====================

function updateProtocolRegistration(enable) {
  if (enable) {
    app.setAsDefaultProtocolClient(PROTOCOL);
  } else {
    app.removeAsDefaultProtocolClient(PROTOCOL);
  }
}

// ==================== 窗口管理 ====================

let mainWindow = null;
let tray = null;

function createWindow(showWindow = true) {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 680,
    resizable: true,
    minWidth: 560,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { height: 48 },
    icon: path.join(__dirname, 'src', 'icon.png'),
    show: showWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));

  // 临时诊断：捕获渲染进程控制台输出（含 uncaught 错误），写入 temp 便于定位
  const consoleLog = path.join(app.getPath('temp'), 'autoduty-console.log');
  mainWindow.webContents.on('console-message', (...args) => {
    let msg = '';
    try {
      const details = args[1] && typeof args[1] === 'object' ? args[1] : null;
      msg = details ? String(details.message ?? '') : String(args[2] ?? '');
    } catch (e) { msg = String(args[2] ?? ''); }
    try {
      fs.appendFileSync(consoleLog, `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) {}
  });

  // 启动数据目录文件监听（外部修改 xlsx 时自动通知界面刷新）
  setupTableWatcher();

  // 如果需要显示，等 ready-to-show 再显示避免白屏
  if (showWindow) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });
  }

  mainWindow.on('close', (e) => {
    if (app.quitting) return;
    e.preventDefault();
    mainWindow.hide();
  });

  // 进入后台（最小化/隐藏到托盘）时销毁渲染进程释放资源，恢复显示时重建
  mainWindow.on('minimize', destroyRenderer);
  mainWindow.on('restore', restoreRenderer);
  mainWindow.on('hide', destroyRenderer);
  mainWindow.on('show', restoreRenderer);

  // 后台启动（startHidden / 开机自启隐藏）：加载完成后立即销毁渲染进程，首次显示时重建
  if (!showWindow) {
    mainWindow.webContents.once('did-finish-load', () => destroyRenderer());
  }
}

// 销毁渲染进程（forcefullyCrashRenderer 会终止渲染进程并静默进入 crashed 状态）
function destroyRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const wc = mainWindow.webContents;
    if (wc && !wc.isDestroyed() && !wc.isCrashed()) wc.forcefullyCrashRenderer();
  } catch (e) {
    // 个别环境不支持时静默忽略
  }
}

// 恢复显示时重建渲染进程（reload 会重新加载页面并恢复 preload/事件订阅）
function restoreRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const wc = mainWindow.webContents;
    if (wc && !wc.isDestroyed() && wc.isCrashed()) wc.reload();
  } catch (e) {
    // 重建失败时忽略（下次显示再试）
  }
}

// 原生窗口管理按钮（最小化/最大化/关闭）跟随深浅色主题：
// 深色下用白色符号，浅色下用深色符号（否则深色模式黑图标不可见）。
// 注意：symbolColor 控制按钮符号颜色，color 是按钮区域底色（与 Mica 标题栏融合）。
function applyTitleBarOverlayTheme() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const dark = nativeTheme.shouldUseDarkColors;
    mainWindow.setTitleBarOverlay({
      color: dark ? '#202020' : '#F3F3F3',
      symbolColor: dark ? '#FFFFFF' : '#1F1F1F',
      height: 48,
    });
  } catch (e) {
    // 当前环境不支持 setTitleBarOverlay 时静默忽略
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'src', 'tray-icon.png'));

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主界面', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: '立即执行', click: () => executeDuty() },
    { type: 'separator' },
    { label: '退出', click: () => { app.quitting = true; app.quit(); } },
  ]);

  tray.setToolTip('AutoDuty 值日提醒');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ==================== 核心执行 ====================

async function executeDuty(template) {
  const apiUrl = store.get('apiUrl');
  const switchHour = store.get('switchHour', 18);
  const tpl = template ?? store.get('dutyTemplate', '');
  const dataDir = getDataDir();

  if (!apiUrl) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('duty:result', {
        success: false,
        message: '未配置 API 地址，请先在设置中填写',
        targetDate: dutyCore.getTargetDate(switchHour),
      });
    }
    return;
  }

  try {
    const result = await dutyCore.runDuty(dataDir, switchHour, apiUrl, tpl);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('duty:result', result);
    }
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('duty:result', {
        success: false,
        message: '执行出错：' + err.message,
        targetDate: dutyCore.getTargetDate(switchHour),
      });
    }
  }
}

// ==================== 定时调度 ====================

let scheduleTimer = null;

function startSchedule() {
  if (scheduleTimer) clearTimeout(scheduleTimer);

  // 精确调度：每次触发后计算到下一个切换时刻的毫秒数再排队，
  // 到点触发，避免每分钟轮询在整点那一分钟被跳过后漏发。
  function nextRunDelay() {
    const switchHour = store.get('switchHour', 18);
    const now = new Date();
    const next = new Date(now);
    next.setHours(switchHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  scheduleTimer = setTimeout(function tick() {
    if (store.get('autoNotify', true) && store.get('apiUrl')) {
      executeDuty();
    }
    scheduleTimer = setTimeout(tick, nextRunDelay());
  }, nextRunDelay());
}

// ==================== IPC 处理 ====================

ipcMain.handle('config:get', () => ({
  apiUrl: store.get('apiUrl'),
  switchHour: store.get('switchHour', 18),
  autoNotify: store.get('autoNotify', true),
  autoStart: store.get('autoStart', false),
  startHidden: store.get('startHidden', false),
  registerProtocol: store.get('registerProtocol', true),
  autoUpdate: store.get('autoUpdate', true),
  updateProxy: store.get('updateProxy', ''),
  theme: store.get('theme', 'system'),
  dutyTemplate: store.get('dutyTemplate', ''),
  currentVersion: CURRENT_VERSION,
}));

ipcMain.handle('config:set', (_, config) => {
  if (config.apiUrl !== undefined) store.set('apiUrl', config.apiUrl);
  if (config.switchHour !== undefined) store.set('switchHour', config.switchHour);
  if (config.autoNotify !== undefined) store.set('autoNotify', config.autoNotify);
  if (config.autoStart !== undefined) {
    store.set('autoStart', config.autoStart);
    updateAutoStart(config.autoStart);
  }
  if (config.startHidden !== undefined) store.set('startHidden', config.startHidden);
  if (config.registerProtocol !== undefined) {
    store.set('registerProtocol', config.registerProtocol);
    updateProtocolRegistration(config.registerProtocol);
  }
  if (config.autoUpdate !== undefined) store.set('autoUpdate', config.autoUpdate);
  if (config.updateProxy !== undefined) store.set('updateProxy', config.updateProxy);
  if (config.theme !== undefined) {
    store.set('theme', config.theme);
    // nativeTheme.themeSource 驱动 Mica 背景与渲染层 prefers-color-scheme
    nativeTheme.themeSource = config.theme === 'light' || config.theme === 'dark'
      ? config.theme
      : 'system';
  }
  if (config.dutyTemplate !== undefined) store.set('dutyTemplate', config.dutyTemplate);
  startSchedule();
  return true;
});

// ==================== 软件更新 ====================

let lastUpdateCheck = null; // 缓存最近一次版本检查结果

// 简单版号比较：a>b→1, a<b→-1, 相等→0（支持 1 / 1.2 / 1.2.3）
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// 从 GitHub Releases 检查更新（AutoDuty 更新源）
const GITHUB_OWNER = 'hrc-090';
const GITHUB_REPO = 'AutoDuty-desktop';
// GitHub 文件加速代理（可选，形如 https://gh-proxy.net/ ；留空则直连）
const GITHUB_PROXY = '';
// 多线程分片下载并发数
const THREADS = 4;
// GitHub 下载加速镜像节点（来源 https://www.moretools.app/zh-CN/github-proxy ）。
// 每个节点均为「前缀式」代理：直接拼接在原始 GitHub 下载 URL 之前。
// '' = 自动测速 | 'direct' = 直连（不使用加速）
const GITHUB_PROXY_NODES = [
  { url: 'https://gh-proxy.net/', label: 'gh-proxy.net' },
  { url: 'https://github.cnxiaobai.com/', label: 'github.cnxiaobai.com' },
  { url: 'https://hub.gitmirror.com/', label: 'hub.gitmirror.com' },
  { url: 'https://www.5555.cab/', label: 'www.5555.cab' },
  { url: 'https://git.tangbai.cc/', label: 'git.tangbai.cc' },
  { url: 'https://gh.ddlc.top/', label: 'gh.ddlc.top' },
  { url: 'https://ghproxy.xiaopa.cc/', label: 'ghproxy.xiaopa.cc' },
  { url: 'https://ghproxy.cfd/', label: 'ghproxy.cfd' },
  { url: 'https://ghproxy.cc/', label: 'ghproxy.cc' },
  { url: 'https://ghproxy.monkeyray.net/', label: 'ghproxy.monkeyray.net' },
  { url: 'https://cf.ghproxy.cc/', label: 'cf.ghproxy.cc' },
  { url: 'https://gitproxy.mrhjx.cn/', label: 'gitproxy.mrhjx.cn' },
  { url: 'https://gh.xxooo.cf/', label: 'gh.xxooo.cf' },
  { url: 'https://github.xxlab.tech/', label: 'github.xxlab.tech' },
  { url: 'https://ghproxy.1888866.xyz/', label: 'ghproxy.1888866.xyz' },
  { url: 'https://github.mlmle.cn/', label: 'github.mlmle.cn' },
  { url: 'https://fastgit.cc/', label: 'fastgit.cc' },
  { url: 'https://gh.1k.ink/', label: 'gh.1k.ink' },
  { url: 'https://github.boringhex.top/', label: 'github.boringhex.top' },
  { url: 'https://ghfast.top/', label: 'ghfast.top' },
  { url: 'https://y.whereisdoge.work/', label: 'y.whereisdoge.work' },
  { url: 'https://ghproxy.imciel.com/', label: 'ghproxy.imciel.com' },
  { url: 'https://gh.jdck.fun/', label: 'gh.jdck.fun' },
  { url: 'https://xiaomo-station.top/', label: 'xiaomo-station.top' },
  { url: 'https://gh.monlor.com/', label: 'gh.monlor.com' },
  { url: 'https://g.blfrp.cn/', label: 'g.blfrp.cn' },
  { url: 'https://gh.con.sh/', label: 'gh.con.sh' },
  { url: 'https://gh.b52m.cn/', label: 'gh.b52m.cn' },
  { url: 'https://github.dpik.top/', label: 'github.dpik.top' },
  { url: 'https://github.geekery.cn/', label: 'github.geekery.cn' },
  { url: 'https://gh.halonice.com/', label: 'gh.halonice.com' },
  { url: 'https://github.limoruirui.com/', label: 'github.limoruirui.com' },
];

// 判断运行形态：安装版（存在 NSIS 卸载注册表项）下载 exe 安装包，否则（便携版/开发版）下载 zip
function isInstalledVersion() {
  if (!app.isPackaged) return false;
  try {
    execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\com.hrc090.autoduty'],
      { stdio: 'pipe' }
    );
    return true;
  } catch (e) {
    return false;
  }
}

async function fetchGitHubRelease(timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 用 releases?per_page=1 而非 releases/latest：无 Release 时 latest 返回 404，列表端点返回 200+[]
    const res = await net.fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=1`,
      { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const releases = await res.json();
    const release = (releases && releases[0]) || null;
    if (!release) return { version: '', url: '', note: '' };
    const tag = String(release.tag_name || '').trim();
    const version = tag.replace(/^[vV]/, '');
    // 便携版下载 zip，安装版下载 exe 安装包
    const assets = release.assets || [];
    const kindPattern = isInstalledVersion() ? /\.exe$/i : /\.zip$/i;
    const asset = assets.find((a) => kindPattern.test(a.name || '')) || assets[0] || null;
    const githubUrl = (asset && asset.browser_download_url) || release.zipball_url || '';
    const url = githubUrl ? (GITHUB_PROXY ? GITHUB_PROXY + githubUrl : githubUrl) : '';
    const note = String(release.body || '').split('\n')[0].trim();
    return { version, url, note };
  } finally {
    clearTimeout(timer);
  }
}

async function checkForUpdate(manual) {
  try {
    const info = await fetchGitHubRelease();
    const latest = info.version || '';
    const hasUpdate = latest && compareVersions(latest, CURRENT_VERSION) > 0;
    lastUpdateCheck = {
      hasUpdate, current: CURRENT_VERSION, latest: latest || null,
      url: info.url || '', note: info.note || '',
      error: null,
    };
  } catch (e) {
    lastUpdateCheck = {
      hasUpdate: false, current: CURRENT_VERSION, latest: null,
      url: '', note: '',
      error: manual ? `检查更新失败：${e.message}` : null,
    };
  }
  return lastUpdateCheck;
}

// 系统是否带 curl（Windows 10 及以上默认内置；其 schannel 网络栈在本机下载明显更快）
function hasCurl() {
  try {
    execFileSync('where', ['curl'], { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

// 获取远程文件大小（用于进度计算与分片）
function getRemoteSize(url) {
  return new Promise((resolve) => {
    execFile('curl.exe', ['-sIL', '--ssl-no-revoke', url], { timeout: 20000 }, (err, stdout) => {
      if (err) return resolve(0);
      // 302 中间跳转可能带 content-length: 0，取最后一个（最终目标）的值
      const matches = String(stdout).match(/content-length:\s*(\d+)/gi);
      if (matches && matches.length) {
        const last = matches[matches.length - 1].replace(/[^\d]/g, '');
        resolve(parseInt(last, 10) || 0);
      } else {
        resolve(0);
      }
    });
  });
}

// 用 curl 下载指定 Range 区间到分片文件；procs 传入后会把子进程登记进去，
// 供取消下载时统一 kill（渲染层调用 update:cancel 会清空该列表）
function downloadRange(url, start, end, outFile, timeoutMs, procs) {
  return new Promise((resolve) => {
    const range = end === null ? `${start}-` : `${start}-${end}`;
    const cp = spawn(
      'curl.exe',
      ['-sL', '--ssl-no-revoke', '--fail', '--retry', '1', '-r', range, '-o', outFile, url],
      { stdio: 'ignore' }
    );
    if (procs) procs.push(cp);
    const t = setTimeout(() => { try { cp.kill(); } catch (e) {} }, timeoutMs);
    const done = () => {
      clearTimeout(t);
      if (procs) {
        const i = procs.indexOf(cp);
        if (i >= 0) procs.splice(i, 1);
      }
      resolve();
    };
    cp.on('exit', done);
    cp.on('error', done);
  });
}

// 多线程分片下载：把文件按 Range 分成 THREADS 段并行下载，再按顺序合并。
// 大小不符（节点不支持 Range / 下载失败）的分片会重试一次；仍失败则返回分片路径列表，成功返回 null。
async function multiThreadDownload(url, total, tmp, state) {
  if (state && state.canceled) return [];
  const segSize = Math.ceil(total / THREADS);
  const parts = [];
  const timeoutMs = 900000; // 单个分片最长 15 分钟（慢分片 5 分钟被 kill 会导致整体失败）
  for (let i = 0; i < THREADS; i++) {
    const start = i * segSize;
    const end = i === THREADS - 1 ? null : Math.min(start + segSize - 1, total - 1);
    const file = `${tmp}.${i}`;
    const expected = end === null ? total - start : end - start + 1;
    parts.push({ file, start, end, expected });
  }
  const procs = state && state.procs;
  // 第一轮：全部分片并行下载
  await Promise.all(parts.map((p) => downloadRange(url, p.start, p.end, p.file, timeoutMs, procs)));
  // 第二轮：对大小不符或缺失的分片重试一次（取消后不再拉起新的子进程）
  for (const p of parts) {
    if (state && state.canceled) break;
    if (!fs.existsSync(p.file) || fs.statSync(p.file).size !== p.expected) {
      await downloadRange(url, p.start, p.end, p.file, timeoutMs, procs);
    }
  }
  // 校验分片
  for (const p of parts) {
    if (!fs.existsSync(p.file) || fs.statSync(p.file).size !== p.expected) return parts;
  }
  // 按顺序合并分片
  try {
    const out = fs.createWriteStream(tmp);
    out.on('error', () => {}); // 打开失败等流错误由 write 回调接管，避免主进程未捕获异常
    for (const p of parts) {
      const data = fs.readFileSync(p.file);
      await new Promise((res, rej) => out.write(data, (e) => (e ? rej(e) : res())));
      fs.unlinkSync(p.file);
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  } catch (e) {
    return parts;
  }
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size !== total) return parts;
  return null; // 成功
}

// 无 curl 环境的单线程回退下载（边下载边写 tmp，进度由外层轮询读取）
async function downloadFallback(url, dest, tmp, setTotal, state) {
  const controller = new AbortController();
  if (state) state.abort = controller;
  const timer2 = setTimeout(() => controller.abort(), 600000);
  try {
    const res = await net.fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    setTotal(total);
    const out = fs.createWriteStream(tmp);
    if (res.body) {
      for await (const chunk of res.body) {
        if (state && state.canceled) throw new Error('aborted');
        const buf = Buffer.from(chunk);
        await new Promise((resolve, reject) => out.write(buf, (e) => (e ? reject(e) : resolve())));
      }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(tmp, dest);
    return { success: true, path: dest };
  } catch (e) {
    if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch (e2) {} }
    return { success: false, message: state && state.canceled ? '已取消下载' : `下载失败：${e.message}` };
  } finally {
    clearTimeout(timer2);
  }
}

// 全局下载状态：供 update:cancel 取消当前正在进行的下载
let activeDownload = null;

// 下载更新包到「下载」目录，按文件大小实时推送进度。
// 节点选择（updateProxy）：''=自动测速选最快节点 | 'direct'=直连 | 具体节点 url=只用该节点；
// 无 curl 时回退单线程 net.fetch；下载过程中可被 update:cancel 取消。
async function downloadUpdate(url) {
  if (!url) return { success: false, message: '没有可用的更新地址' };
  const dir = app.getPath('downloads');
  const name = (path.basename(url.split('?')[0]) || 'autoduty-update.zip');
  const dest = path.join(dir, name);
  const tmp = dest + '.part';
  const base = path.basename(tmp);
  // 本次下载的全局状态：canceled 标记 + 正在运行的 curl 子进程 + 回退下载的 abort
  const state = { canceled: false, procs: [], abort: null };
  activeDownload = state;
  let currentTotal = 0;
  let chunkFiles = [];

  const setTotal = (t) => { currentTotal = t; };

  // 清理本次下载产生的全部临时文件（tmp / 分片 / 探速文件）
  const cleanup = () => {
    for (const cp of state.procs) { try { cp.kill(); } catch (e) {} }
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(base) && f !== name) {
          try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
        }
      }
    } catch (e) {}
  };

  // 进度轮询：统计已写入的字节数（分片阶段累加分片，合并阶段读 tmp）
  const timer = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      let size = 0;
      if (fs.existsSync(tmp)) {
        try { size = fs.statSync(tmp).size; } catch (e) {}
      } else {
        for (const f of chunkFiles) {
          try { if (fs.existsSync(f)) size += fs.statSync(f).size; } catch (e) {}
        }
      }
      const percent = currentTotal > 0 ? Math.floor((size / currentTotal) * 100) : -1;
      mainWindow.webContents.send('update:progress', { received: size, total: currentTotal, percent });
    }
  }, 800);

  try {
    // 清理上次残留的临时文件（.part 及其分片/探速文件），避免被占用导致合并时 EPERM
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(base) && f !== name) {
          try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
        }
      }
    } catch (e) {}

    // 无 curl 时回退单线程下载（取消时内部会映射为「已取消下载」）
    if (!hasCurl()) return await downloadFallback(url, dest, tmp, setTotal, state);

    // 候选节点：按用户选择决定
    const selected = store.get('updateProxy', '');
    let candidates;
    if (selected === 'direct') {
      candidates = [url];
    } else if (selected) {
      candidates = [selected + url];
    } else {
      candidates = [url, ...GITHUB_PROXY_NODES.map((n) => n.url + url)];
    }

    let source = candidates[0];
    if (candidates.length > 1) {
      // 自动模式：并行探速，每个节点下载前 4MB，选最快可用的节点做正式下载
      const probeSize = 4 * 1024 * 1024;
      const probes = await Promise.all(candidates.map(async (cand, i) => {
        const probeFile = `${tmp}.probe${i}`;
        const started = Date.now();
        await downloadRange(cand, 0, probeSize - 1, probeFile, 15000, state.procs);
        let speed = 0;
        try {
          if (fs.existsSync(probeFile) && fs.statSync(probeFile).size === probeSize) {
            speed = probeSize / Math.max(1, Date.now() - started);
          }
        } catch (e) {}
        try { fs.unlinkSync(probeFile); } catch (e) {}
        return { cand, speed };
      }));
      if (state.canceled) {
        cleanup();
        return { success: false, message: '已取消下载' };
      }
      const best = probes.reduce((a, b) => (b.speed > a.speed ? b : a), probes[0]);
      if (best && best.speed > 0) source = best.cand;
    }

    const total = await getRemoteSize(source);
    if (state.canceled) {
      cleanup();
      return { success: false, message: '已取消下载' };
    }
    let lastErr = total > 0 ? '' : '无法获取文件大小';
    if (total > 0) {
      setTotal(total);
      chunkFiles = Array.from({ length: THREADS }, (_, i) => `${tmp}.${i}`);
      const chunks = await multiThreadDownload(source, total, tmp, state);
      if (state.canceled) {
        cleanup();
        return { success: false, message: '已取消下载' };
      }
      if (chunks === null) {
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          fs.renameSync(tmp, dest);
          return { success: true, path: dest };
        } catch (e) {
          return { success: false, message: `保存文件失败：${e.message}` };
        }
      }
      // 正式下载失败：清理分片
      for (const f of chunks) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {} }
      chunkFiles = [];
      if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch (e) {} }
      lastErr = `下载失败（${source}）`;
    }
    return { success: false, message: lastErr || '下载失败：所有节点均无法完成下载' };
  } catch (e) {
    return { success: false, message: state.canceled ? '已取消下载' : `下载失败：${e.message}` };
  } finally {
    clearInterval(timer);
    if (activeDownload === state) activeDownload = null;
  }
}

// 节点列表（供设置页「GitHub 加速节点」选择框）
ipcMain.handle('update:proxyList', () => GITHUB_PROXY_NODES);

// 快速验证地址可达（HEAD 成功即可，用于挑选探测基准）
async function urlReachable(u) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await net.fetch(u, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
      return res.ok;
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    return false;
  }
}

// 挑选可用的探测基准：优先真实 Release 附件；其次仓库归档（main/master 分支各试）；
// 最后回退 github 首页。逐个做可达性校验，避免基准地址 404 导致全节点测速为 0。
async function resolveProbeBase(url) {
  if (url && (await urlReachable(url))) return url;
  const candidates = [];
  try {
    const info = await fetchGitHubRelease(8000);
    if (info.url) candidates.push(info.url);
  } catch (e) {}
  candidates.push(
    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/heads/main.zip`,
    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/heads/master.zip`,
    'https://github.com/'
  );
  for (const c of candidates) {
    if (await urlReachable(c)) return c;
  }
  return 'https://github.com/';
}

// 探速下载：开放区间 -r 0- + --max-time，兼容不支持 Range 的节点；
// 小文件（如首页）立即取完，大文件在超时窗口内测量持续吞吐。
function probeRange(url, outFile, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const cp = spawn(
      'curl.exe',
      ['-sL', '--ssl-no-revoke', '--fail', '-r', '0-', '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1000))), '-o', outFile, url],
      { stdio: 'ignore' }
    );
    const done = (size) => resolve({ size, elapsed: Math.max(1, Date.now() - started) });
    cp.on('exit', () => {
      let size = 0;
      try { if (fs.existsSync(outFile)) size = fs.statSync(outFile).size; } catch (e) {}
      done(size);
    });
    cp.on('error', () => done(0));
  });
}

// 延迟测速：只取前 4KB（-r 0-4095），耗时即连接延迟（ms），快速且兼容多数节点。
// 不支持 Range 的节点会返回完整文件，超时窗口内结束，耗时大 → 自动排后。
function probeLatency(url, outFile, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const cp = spawn(
      'curl.exe',
      ['-sL', '--ssl-no-revoke', '--fail', '-r', '0-4095', '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1000))), '-o', outFile, url],
      { stdio: 'ignore' }
    );
    const done = (size) => resolve({ size, elapsed: Math.max(1, Date.now() - started) });
    cp.on('exit', () => {
      let size = 0;
      try { if (fs.existsSync(outFile)) size = fs.statSync(outFile).size; } catch (e) {}
      done(size);
    });
    cp.on('error', () => done(0));
  });
}

// 对全部节点（含直连）并行测延迟，返回耗时(ms)升序结果（保持快速，约 5 秒内）。
// 探测基准经过可达性校验：真实 Release 附件 → 仓库归档 → github 首页。
ipcMain.handle('update:testSpeed', async (_, url) => {
  const probeBase = await resolveProbeBase(url);
  const TIMEOUT = 5000;
  const nodes = [{ url: '', label: '直连' }, ...GITHUB_PROXY_NODES];
  const results = await Promise.all(nodes.map(async (node, i) => {
    const cand = node.url ? node.url + probeBase : probeBase;
    const probeFile = path.join(app.getPath('temp'), `autoduty-probe-${Date.now()}-${i}.part`);
    const { size, elapsed } = await probeLatency(cand, probeFile, TIMEOUT);
    try { if (fs.existsSync(probeFile)) fs.unlinkSync(probeFile); } catch (e) {}
    return { url: node.url, label: node.label, ms: elapsed, ok: size > 0 };
  }));
  // 排序：可用节点按延迟升序（越快越靠前），不可用节点排最后
  results.sort((a, b) => (a.ok === b.ok ? a.ms - b.ms : a.ok ? -1 : 1));
  return results;
});

// 取消当前正在进行的下载
ipcMain.handle('update:cancel', () => {
  if (!activeDownload) return { success: false, message: '没有正在进行的下载' };
  activeDownload.canceled = true;
  for (const cp of activeDownload.procs) { try { cp.kill(); } catch (e) {} }
  if (activeDownload.abort) { try { activeDownload.abort(); } catch (e) {} }
  return { success: true };
});

// 立即安装：安装版启动 exe 安装程序；便携版解压 zip 后启动，随后退出当前应用
function launchInstaller(dest) {
  if (isInstalledVersion()) {
    const cp = spawn(dest, [], { detached: true, stdio: 'ignore' });
    cp.unref();
    setTimeout(() => app.quit(), 1500);
    return;
  }
  // 便携版：解压 zip 到下载目录下同名文件夹后启动
  const targetDir = path.join(path.dirname(dest), path.basename(dest, path.extname(dest)));
  const exePath = path.join(targetDir, 'AutoDuty.exe');
  const tryLaunch = () => {
    if (fs.existsSync(exePath)) {
      // 带 --duty-update 启动新版：跳过单实例锁，与旧实例短暂并存后由旧实例退出让位
      spawn(exePath, ['--duty-update'], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 1200);
    } else {
      shell.openPath(path.dirname(dest));
    }
  };
  if (fs.existsSync(exePath)) {
    tryLaunch();
    return;
  }
  // 用 -EncodedCommand 传命令，绕开 Node 在 Windows 上的参数引号转义问题。
  // 注意：解压进程不能带 detached:true，否则 powershell 会不执行命令直接退出。
  const expandCmd =
    `Expand-Archive -LiteralPath '${String(dest).replace(/'/g, "''")}' ` +
    `-DestinationPath '${String(targetDir).replace(/'/g, "''")}' -Force`;
  const encoded = Buffer.from(expandCmd, 'utf16le').toString('base64');
  const cp = spawn(
    'powershell.exe',
    ['-NoProfile', '-EncodedCommand', encoded],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  cp.stdout.on('data', () => {}); // 丢弃进度输出，避免管道填满阻塞子进程
  cp.stderr.on('data', (d) => { if (d && d.length) console.error('[update:expand]', String(d)); });
  cp.on('error', (e) => console.error('[update:expand] spawn error:', e));
  cp.on('exit', tryLaunch);
}

ipcMain.handle('update:check', (_, manual) => checkForUpdate(manual !== false));

ipcMain.handle('update:download', (_, url) => downloadUpdate(url));

ipcMain.handle('update:install', (_, dest) => {
  if (!dest || !fs.existsSync(dest)) return { success: false, message: '安装包不存在' };
  try {
    launchInstaller(dest);
    return { success: true, message: '正在启动安装…' };
  } catch (e) {
    return { success: false, message: `启动安装失败：${e.message}` };
  }
});

// 供渲染层读取当前版本与最近一次检查结果
ipcMain.handle('update:status', () => ({
  current: CURRENT_VERSION,
  lastUpdateCheck,
}));

// 启动后后台自动检查更新（可开关）
function autoCheckUpdate() {
  if (!store.get('autoUpdate', true)) return;
  setTimeout(async () => {
    const info = await checkForUpdate(false);
    if (info.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', info);
    }
  }, 4000);
}

ipcMain.handle('duty:execute', (_, template) => executeDuty(template));

ipcMain.handle('duty:preview', (_, template) => {
  const switchHour = store.get('switchHour', 18);
  const dataDir = getDataDir();
  dutyCore.ensureDataFiles(dataDir);
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  const targetDate = dutyCore.getTargetDate(switchHour);
  const tpl = template ?? store.get('dutyTemplate', '');
  const dutyText = dutyCore.getDutyForDate(dutyPath, targetDate, tpl);
  return { targetDate, dutyText, switchHour };
});

// 按指定日期预览（不依赖切换时间）
ipcMain.handle('duty:previewDate', (_, dateStr, template) => {
  const dataDir = getDataDir();
  dutyCore.ensureDataFiles(dataDir);
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  const tpl = template ?? store.get('dutyTemplate', '');
  const dutyText = dutyCore.getDutyForDate(dutyPath, dateStr, tpl);
  return { targetDate: dateStr, dutyText };
});

ipcMain.handle('duty:getAll', () => {
  const dataDir = getDataDir();
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  return dutyCore.readDutyTable(dutyPath);
});

ipcMain.handle('duty:save', (_, data) => {
  try {
    const dataDir = getDataDir();
    const dutyPath = path.join(dataDir, '值日表.xlsx');
    dutyCore.writeDutyTable(dutyPath, data);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message || String(err) };
  }
});

// 导入外部 xlsx 文件为值日表
ipcMain.handle('duty:import', async () => {
  let result;
  try {
    // mainWindow 可能已销毁/不可用，此时用无父窗口的对话框兜底
    result = await dialog.showOpenDialog(
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      {
        title: '选择值日表文件',
        filters: [
          { name: 'Excel 文件', extensions: ['xlsx', 'xls'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile'],
      }
    );
  } catch (err) {
    return { success: false, message: '无法打开文件选择框：' + err.message };
  }

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: '已取消' };
  }

  const srcPath = result.filePaths[0];
  const dataDir = getDataDir();
  dutyCore.ensureDataFiles(dataDir);
  const destPath = path.join(dataDir, '值日表.xlsx');

  try {
    const importResult = dutyCore.importDutyTable(srcPath, destPath);
    return importResult;
  } catch (err) {
    return { success: false, message: '导入失败：' + err.message };
  }
});

// 导入外部 xlsx 文件为别名表
ipcMain.handle('alias:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择别名表文件',
    filters: [
      { name: 'Excel 文件', extensions: ['xlsx', 'xls'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: '已取消' };
  }

  const srcPath = result.filePaths[0];
  const dataDir = getDataDir();
  dutyCore.ensureDataFiles(dataDir);
  const destPath = path.join(dataDir, 'aliases.xlsx');

  try {
    const importResult = dutyCore.importAliasTable(srcPath, destPath);
    return importResult;
  } catch (err) {
    return { success: false, message: '导入失败：' + err.message };
  }
});

ipcMain.handle('alias:getAll', () => {
  const dataDir = getDataDir();
  const aliasPath = path.join(dataDir, 'aliases.xlsx');
  return dutyCore.readAliasTable(aliasPath);
});

ipcMain.handle('alias:save', (_, entries) => {
  try {
    const dataDir = getDataDir();
    const aliasPath = path.join(dataDir, 'aliases.xlsx');
    dutyCore.writeAliasTable(aliasPath, entries);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message || String(err) };
  }
});

ipcMain.handle('duty:fillNames', () => {
  const dataDir = getDataDir();
  const { dutyPath, aliasPath } = dutyCore.ensureDataFiles(dataDir);
  const aliasDict = dutyCore.loadAliases(aliasPath);
  return dutyCore.fillDutyWithRealNames(dutyPath, aliasDict);
});

// 批量分配日期（按交接日自动续排，无起止日期）
ipcMain.handle('duty:assignDates', (_, { weekdays }) => {
  const dataDir = getDataDir();
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  try {
    return dutyCore.assignDates(dutyPath, weekdays);
  } catch (e) {
    return { assigned: 0, message: '分配失败：' + (e?.message || e) };
  }
});

// 本地打开表格文件（系统默认程序 Excel/WPS），便于直接编辑后自动同步
ipcMain.handle('table:openLocal', async (_, name) => {
  try {
    const dataDir = getDataDir();
    const file = path.join(dataDir, name === 'alias' ? 'aliases.xlsx' : '值日表.xlsx');
    if (!fs.existsSync(file)) dutyCore.ensureDataFiles(dataDir);
    const err = await shell.openPath(file);
    if (err) return { success: false, message: '打开失败：' + err };
    return { success: true, message: '已用默认程序打开，修改保存后应用自动同步' };
  } catch (e) {
    return { success: false, message: '打开失败：' + (e?.message || e) };
  }
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
});

// ==================== 应用生命周期 ====================

// 单实例锁，确保只有一个应用运行。
// 通过 --duty-update 启动的新版实例跳过锁，与即将退出的旧实例短暂并存，接管运行。
const gotTheLock = process.argv.includes('--duty-update') ? true : app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    dutyCore.ensureDataFiles(getDataDir());

    // 应用主题配置：驱动 Mica 背景与渲染层 prefers-color-scheme
    const theme = store.get('theme', 'system');
    nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system';

    // 判断是否开机自启静默模式
    const isAutoStartHidden = process.argv.includes('--hidden');
    const startHidden = isAutoStartHidden || store.get('startHidden', false);

    // 创建窗口（静默模式不显示）
    createWindow(!startHidden);
    // 窗口管理按钮跟随主题；nativeTheme 变化（系统或设置切换）时自动刷新
    applyTitleBarOverlayTheme();
    nativeTheme.on('updated', applyTitleBarOverlayTheme);
    createTray();
    startSchedule();
    autoCheckUpdate();

    // 根据配置决定是否注册 URL 协议
    if (store.get('registerProtocol', true)) {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }

    // 根据配置决定是否开机自启
    if (store.get('autoStart', false)) {
      updateAutoStart(true);
    }

    // 检查是否通过 URL 协议启动（首次启动时）
    const urlArg = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
    if (urlArg) {
      handleProtocolUrl(urlArg);
    }
  });
}

app.on('before-quit', () => {
  app.quitting = true;
  if (scheduleTimer) clearTimeout(scheduleTimer);
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});