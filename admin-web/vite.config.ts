import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig(({ command, mode }) => {
  const record = String(loadEnv(mode, process.cwd(), 'VITE_').VITE_ICP_RECORD || process.env.VITE_ICP_RECORD || '').trim();
  if (command === 'build' && record && !/^[\u4e00-\u9fff]ICP备\d{8,15}号(?:-\d+)?$/.test(record)) {
    throw new Error('VITE_ICP_RECORD 必须为该网站的完整 ICP 备案号；本地开发可留空。');
  }
  return {
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.BOOKING_API_URL || 'http://127.0.0.1:3310',
        changeOrigin: true,
      },
    },
  },
  build: { sourcemap: false },
  };
});
