/* 설정: 환경 변수 → 없으면 /etc/jcalender.env (설치 스크립트가 만듦) */
import fs from 'fs';

const ENV_FILE = process.env.JCAL_ENV_FILE || '/etc/jcalender.env';
try {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* 파일 없음 (개발 환경) */ }

const env = process.env;
export const config = {
  port: Number(env.PORT || 8787),
  host: env.HOST || '127.0.0.1',                       // Caddy 뒤에서만 받는다
  databaseUrl: env.DATABASE_URL || 'postgres:///jcal',
  // 화면 주소 (쉼표로 여러 개, *.vercel.app 처럼 * 사용 가능)
  origins: (env.ALLOWED_ORIGINS || 'https://*.vercel.app,http://localhost:5288,http://127.0.0.1:5288').split(',').map(s => s.trim()).filter(Boolean),
  sessionDays: Number(env.SESSION_DAYS || 90),
  maxBodyMb: Number(env.MAX_BODY_MB || 30),            // 명함 이미지가 들어 있으면 클 수 있음
};
