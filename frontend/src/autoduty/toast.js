// 轻量 WinUI 风格 Toast（InfoBar 样式）共享状态
import { reactive } from 'vue';

export const toastState = reactive({ visible: false, text: '', timer: null });

export function showToast(msg, duration = 2500) {
  clearTimeout(toastState.timer);
  toastState.text = msg;
  toastState.visible = true;
  toastState.timer = setTimeout(() => {
    toastState.visible = false;
  }, duration);
}