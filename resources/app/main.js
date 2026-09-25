/**
 * main.js - Electron 主进程
 */

const electron = require('electron');
const { app, BrowserWindow, Tray, Menu, dialog, shell, net } = electron;
const ipcMain = electron.ipcMain;
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
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
  },
});

function getDataDir() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'data');
  }
  return path.join(__dirname, 'data');
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

async function executeDuty() {
  const apiUrl = store.get('apiUrl');
  const switchHour = store.get('switchHour', 18);
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
    const result = await dutyCore.runDuty(dataDir, switchHour, apiUrl);
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

// 下载更新包到「下载」目录，实时推送进度，完成后打开所在文件夹
async function downloadUpdate(url) {
  if (!url) return { success: false, message: '没有可用的更新地址' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600000); // 10 分钟超时，避免网络挂起无反馈
  try {
    const dir = app.getPath('downloads');
    const name = (path.basename(url.split('?')[0]) || 'autoduty-update.zip');
    const dest = path.join(dir, name);
    const res = await net.fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    const chunks = [];
    let received = 0;
    let lastSent = -1;
    if (res.body) {
      for await (const chunk of res.body) {
        const buf = Buffer.from(chunk);
        chunks.push(buf);
        received += buf.length;
        const percent = total > 0 ? Math.floor((received / total) * 100) : -1;
        if (percent !== lastSent) {
          lastSent = percent;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update:progress', { received, total, percent });
          }
        }
      }
    }
    fs.writeFileSync(dest, Buffer.concat(chunks));
    return { success: true, path: dest };
  } catch (e) {
    return { success: false, message: `下载失败：${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

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

ipcMain.handle('duty:execute', () => executeDuty());

ipcMain.handle('duty:preview', () => {
  const switchHour = store.get('switchHour', 18);
  const dataDir = getDataDir();
  dutyCore.ensureDataFiles(dataDir);
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  const targetDate = dutyCore.getTargetDate(switchHour);
  const dutyText = dutyCore.getDutyForDate(dutyPath, targetDate);
  return { targetDate, dutyText, switchHour };
});

// 按指定日期预览（不依赖切换时间）
ipcMain.handle('duty:previewDate', (_, dateStr) => {
  const dataDir = getDataDir();
  dutyCore.ensureDataFiles(dataDir);
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  const dutyText = dutyCore.getDutyForDate(dutyPath, dateStr);
  return { targetDate: dateStr, dutyText };
});

ipcMain.handle('duty:getAll', () => {
  const dataDir = getDataDir();
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  return dutyCore.readDutyTable(dutyPath);
});

ipcMain.handle('duty:save', (_, data) => {
  const dataDir = getDataDir();
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  dutyCore.writeDutyTable(dutyPath, data);
  return true;
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
  const dataDir = getDataDir();
  const aliasPath = path.join(dataDir, 'aliases.xlsx');
  dutyCore.writeAliasTable(aliasPath, entries);
  return true;
});

ipcMain.handle('duty:fillNames', () => {
  const dataDir = getDataDir();
  const { dutyPath, aliasPath } = dutyCore.ensureDataFiles(dataDir);
  const aliasDict = dutyCore.loadAliases(aliasPath);
  return dutyCore.fillDutyWithRealNames(dutyPath, aliasDict);
});

// 批量分配日期
ipcMain.handle('duty:assignDates', (_, { startDate, count, skipWeekends }) => {
  const dataDir = getDataDir();
  const dutyPath = path.join(dataDir, '值日表.xlsx');
  return dutyCore.assignDates(dutyPath, startDate, count, skipWeekends);
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

    // 判断是否开机自启静默模式
    const isAutoStartHidden = process.argv.includes('--hidden');
    const startHidden = isAutoStartHidden || store.get('startHidden', false);

    // 创建窗口（静默模式不显示）
    createWindow(!startHidden);
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