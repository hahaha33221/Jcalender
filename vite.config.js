import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 다른 로컬 프로젝트(기본 5173)와 겹치지 않도록 전용 포트 사용
// /api 는 같은 주소로 부르고 여기서 API 서버로 넘긴다 (배포는 vercel.json rewrites) — 서버 주소를 화면 코드에 넣지 않기 위해
// 내 컴퓨터 시험: 기본 http://127.0.0.1:8787, 다른 서버는 JCAL_API=https://… npm run dev
const api = { '/api': { target: process.env.JCAL_API || 'http://127.0.0.1:8787', changeOrigin: true, secure: true } };
export default defineConfig({
  plugins: [react()],
  server: { port: 5288, strictPort: true, proxy: api },
  preview: { port: 5289, strictPort: true, proxy: api },
});
