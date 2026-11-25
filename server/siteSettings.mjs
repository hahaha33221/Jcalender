/* 사이트에서 넣는 서버 설정 — AI 키 · 녹음 서버 토큰 · 회의록 모델 (관리자 화면 › 녹음 · 회의록 › 설정)
   - 저장: 서버의 상태 폴더 파일 하나 (/var/lib/jcalender/site-settings.json, jcal 사용자만 읽기 · 쓰기 600)
     저장소(GitHub) · DB · DB 백업에는 들어가지 않는다
   - 서버가 켜질 때와 저장할 때 process.env 에 반영 → 숏폼 · 아이디어 뱅크 · 목표 AI 도 같은 키를 쓴다
   - 사이트에서 넣은 값이 /etc/jcalender.env(jcal-admin ai-key)보다 우선. 사이트에서 지우면 설정 파일 값으로 돌아간다 */
import './config.mjs';                                      // /etc/jcalender.env 를 먼저 읽어 둔다 (base 에 들어가게)
import fs from 'fs';
import path from 'path';

const env = process.env;
export const SITE_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'RECORDING_API_TOKEN', 'MINUTES_MODEL', 'MINUTES_STT_MODEL', 'MINUTES_AUTO'];
const FILE = env.JCAL_SITE_SETTINGS || path.join(env.STATE_DIRECTORY ? env.STATE_DIRECTORY.split(':')[0] : path.resolve('data'), 'site-settings.json');
const base = Object.fromEntries(SITE_KEYS.map(k => [k, env[k]]));   // 서버 설정 파일(/etc/jcalender.env)에서 온 값
let saved = {};

const apply = () => { for (const k of SITE_KEYS) { const v = saved[k] ?? base[k]; if (v === undefined || v === '') delete env[k]; else env[k] = v; } };
export function loadSiteSettings() {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); saved = Object.fromEntries(Object.entries(j).filter(([k, v]) => SITE_KEYS.includes(k) && typeof v === 'string')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('[사이트 설정] 읽기 실패', e.message); saved = {}; }
  apply();
}
/** changes: { KEY: '값' | null(사이트 값 지우기) } */
export function saveSiteSettings(changes) {
  const next = { ...saved };
  for (const [k, v] of Object.entries(changes)) { if (!SITE_KEYS.includes(k)) continue; if (v == null || v === '') delete next[k]; else next[k] = String(v); }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  saved = next;
  apply();
}
/** 어디서 온 값인지: site(사이트에서 넣음) · server(서버 설정 파일) · '' */
export const sourceOf = k => (saved[k] ? 'site' : base[k] ? 'server' : '');
export const mask = v => (!v ? '' : v.length <= 10 ? '••••' : `${v.slice(0, v.startsWith('sk-ant-') ? 7 : 3)}…${v.slice(-4)}`);
