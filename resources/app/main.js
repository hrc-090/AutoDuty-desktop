/**
 * main.js - Electron 主进程
 */

const electron = require('electron');
const { app, BrowserWindow, Tray, Menu, dialog, shell, net } = electron;
const ipcMain = electron.ipcMain;
const path = require('path');
const fs = require('fs');
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
    updateUrl: '',
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
    width: 520,
    height: 680,
    resizable: true,
    minWidth: 420,
    minHeight: 500,
    frame: false,
    icon: path.join(__dirname, 'src', 'icon.png'),
    show: showWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

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
  updateUrl: store.get('updateUrl', ''),
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
  if (config.updateUrl !== undefined) store.set('updateUrl', config.updateUrl);
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

// 更新源 JSON 约定：{ "version":"1.1.0", "url":"https://.../autoduty-update.zip", "note":"更新说明" }
async function fetchUpdateInfo(updateUrl, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await net.fetch(updateUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function checkForUpdate(manual) {
  const updateUrl = (store.get('updateUrl') || '').trim();
  if (!updateUrl) {
    lastUpdateCheck = {
      hasUpdate: false, current: CURRENT_VERSION, latest: null,
      url: '', note: '',
      error: manual ? '未配置更新源地址，请先在设置中填写' : null,
    };
    return lastUpdateCheck;
  }
  try {
    const info = await fetchUpdateInfo(updateUrl);
    const latest = String(info.version || '').trim();
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

// 下载更新包到「下载」目录，完成后打开所在文件夹
async function downloadUpdate(url) {
  if (!url) return { success: false, message: '没有可用的更新地址' };
  try {
    const dir = app.getPath('downloads');
    const name = (path.basename(url.split('?')[0]) || 'autoduty-update.zip');
    const dest = path.join(dir, name);
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    shell.openPath(dir);
    return { success: true, path: dest };
  } catch (e) {
    return { success: false, message: `下载失败：${e.message}` };
  }
}

ipcMain.handle('update:check', (_, manual) => checkForUpdate(manual !== false));

ipcMain.handle('update:download', (_, url) => downloadUpdate(url));

// 供渲染层读取当前版本与最近一次检查结果
ipcMain.handle('update:status', () => ({
  current: CURRENT_VERSION,
  lastUpdateCheck,
}));

// 启动后后台自动检查更新（可开关）
function autoCheckUpdate() {
  if (!store.get('autoUpdate', true)) return;
  const updateUrl = (store.get('updateUrl') || '').trim();
  if (!updateUrl) return;
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
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择值日表文件',
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

// 单实例锁，确保只有一个应用运行
const gotTheLock = app.requestSingleInstanceLock();

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