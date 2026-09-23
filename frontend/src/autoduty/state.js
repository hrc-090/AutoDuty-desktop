// 跨页面共享的响应式状态（App 级统一监听 duty result，供首页等消费）
import { reactive } from 'vue';

export const homeState = reactive({
  last: '--',
  tick: 0,
  executing: false,
});