// 精简封装 Electron preload 注入的 window.autoduty（IPC 桥接面，见 AutoDuty preload.js）。
const api = typeof window !== 'undefined' && window.autoduty ? window.autoduty : null;

export function useAutoduty() {
  return api;
}

export const autodutyApi = api;