import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 다른 로컬 프로젝트(기본 5173)와 겹치지 않도록 전용 포트 사용
export default defineConfig({
  plugins: [react()],
  server: { port: 5288, strictPort: true },
  preview: { port: 5289, strictPort: true },
});
