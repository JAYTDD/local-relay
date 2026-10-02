import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 必须是 /panel/：产物由 local-relay 挂在 /panel 下
export default defineConfig({
  base: '/panel/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      // 开发态把面板 API 代理到网关，避免 CORS
      '/panel/api': 'http://127.0.0.1:8790',
    },
  },
});
