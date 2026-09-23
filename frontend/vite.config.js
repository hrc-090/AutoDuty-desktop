import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('./', import.meta.url));

export default defineConfig({
  // 相对 base，便于 Electron loadFile(file://) 下正确解析资源
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      // 直接复用 WinUIonWeb 组件库源码（不改动上游仓库）
      '@winui': 'd:/WinUIonWeb/WinUIonWeb/src',
    },
  },
  build: {
    outDir: path.resolve(root, '../resources/app/dist'),
    emptyOutDir: true,
  },
});