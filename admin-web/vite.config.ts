import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
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
});
