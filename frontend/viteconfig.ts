// frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Обязательный базовый путь для репозитория https://smok3644.github.io/SSSellerMindBot/
  base: '/SSSellerMindBot/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});