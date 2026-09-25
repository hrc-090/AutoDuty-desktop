/**
 * preload.js - 安全桥接
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('autoduty', {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),

  // 值日执行
  executeDuty: () => ipcRenderer.invoke('duty:execute'),
  previewDuty: () => ipcRenderer.invoke('duty:preview'),
  previewDutyDate: (dateStr) => ipcRenderer.invoke('duty:previewDate', dateStr),

  // 值日表 CRUD
  getDutyAll: () => ipcRenderer.invoke('duty:getAll'),
  saveDuty: (data) => ipcRenderer.invoke('duty:save', data),
  importDuty: () => ipcRenderer.invoke('duty:import'),

  // 批量分配日期
  assignDates: (opts) => ipcRenderer.invoke('duty:assignDates', opts),

  // 别名表 CRUD
  getAliasAll: () => ipcRenderer.invoke('alias:getAll'),
  saveAlias: (entries) => ipcRenderer.invoke('alias:save', entries),
  importAlias: () => ipcRenderer.invoke('alias:import'),

  // 自动填充
  fillNames: () => ipcRenderer.invoke('duty:fillNames'),

  // 软件更新
  checkUpdate: (manual) => ipcRenderer.invoke('update:check', manual),
  downloadUpdate: (url) => ipcRenderer.invoke('update:download', url),
  installUpdate: (dest) => ipcRenderer.invoke('update:install', dest),
  updateStatus: () => ipcRenderer.invoke('update:status'),

  // 窗口控制
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),

  // 事件监听
  onDutyResult: (callback) => {
    ipcRenderer.on('duty:result', (_, result) => callback(result));
  },
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update:available', (_, info) => callback(info));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update:progress', (_, info) => callback(info));
  },
});