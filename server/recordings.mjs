/* 녹음 · 회의록 — 휴대폰 녹음을 받는 서버(recording-api, 서비스 jcal-recording)에 올라온 녹음을 받아 적고(STT) AI 로 회의록을 만든다
   (db/migrations/013_recordings.sql · 관리자 계정만)
   GET  /api/minutes                 → { ready, auto, today, limit, items: [{ id, filename, device, at, status, title, kind, summary, … }] }
   GET  /api/minutes/item?id=        → { item: { …, transcript, minutes } }
   POST /api/minutes/process {id}    지금 만들기 · 다시 만들기 (대기열 맨 앞)
   POST /api/minutes/delete  {id}    녹음 파일 · 회의록 지우기 (recording-api 에서도 지움)
   GET  /api/minutes/audio?id=       녹음 파일 (재생용, recording-api 에서 받아 그대로 넘김)
   POST /api/minutes/process {ids: [..]}  여러 개를 한 번에 (예전 녹음 골라 만들기)
   POST /api/minutes/upload?u=&i=&n=&name=&at=&make=  사이트에서 예전 녹음 올리기 — 4MB 조각으로 받아 모은 뒤 녹음 서버로 넘김
        (조각이라 Nginx · Vercel 크기 · 시간 제한에 안 걸림, 같은 내용은 녹음 서버가 SHA-256 으로 걸러 "이미 있음")
        올린 녹음은 "수동"(자동 정리 안 함), make=1 이면 바로 회의록 대기열
   GET  /api/minutes/dashboard       회의록 대시보드 (건수 · 종류 · 월별 · 할 일 모음 · 자주 만난 사람 · 최근)
   POST /api/minutes/step {id, i, done}  회의록 할 일 끝냄 표시 (minutes.done_steps)
   POST /api/minutes/text {name, at, text, make, kind?}  kind: auto | minutes | transcript — Word(docx) · 1.개요~6.기타 제목이 있는 글은
        "이미 정리된 회의록"으로 AI 없이 완료 저장 (원문은 minutes.raw)
   POST /api/minutes/text {name, at, text, make}  예전 TXT(받아 적은 글 · 메모) 올리기 — 받아쓰기 없이 글로 회의록
        같은 이름의 녹음(확장자만 다름)이 아직 회의록 전이면 그 녹음의 받아쓴 글로 붙인다. 같은 글은 "이미 있음"
        글만 있는 항목은 번호가 음수 (녹음 서버에 없음)
   GET  /api/minutes/settings        설정 상태 (키는 가린 값 · 어디서 왔는지, 녹음 서버 연결 시험 · 업로드 주소 · 토큰)
   POST /api/minutes/settings {openaiKey?, anthropicKey?, recToken?, model?, sttModel?, auto?, clear?: ['openai' | 'anthropic' | 'recToken']}
        키는 저장 전에 그 회사에 확인 (틀린 키는 저장 안 함) → server/siteSettings.mjs 파일에 저장
   흐름: 1분마다 recording-api 목록 확인 → 새 녹음은 "대기" → 한 번에 1건씩
         ffmpeg 로 16kHz 모노 mp3 · 10분 단위로 나눔 → OpenAI 받아쓰기 → AI(Claude 우선) 회의록 JSON → 저장
   설정 (환경 변수, /etc/jcalender.env)
     RECORDING_API_URL (기본 http://127.0.0.1:8790) · RECORDING_API_TOKEN (setup.sh 가 /etc/jcal-recording.env 의 API_TOKEN 을 옮겨 넣음)
     MINUTES_AUTO=0 이면 자동 처리 안 함 (버튼으로만) · MINUTES_DAILY 하루 자동 처리 한도 (기본 30)
     MINUTES_BACKFILL_HOURS 처음 발견했을 때 이 시간 안에 올라온 녹음만 자동 처리 (기본 48, 나머지는 버튼)
     MINUTES_MAX_MIN 이보다 긴 녹음은 자동 처리 안 함 (기본 180분)
     MINUTES_STT_MODEL (기본 STT_MODEL 또는 gpt-4o-mini-transcribe, 키 OPENAI_API_KEY)
     MINUTES_PROVIDER anthropic | openai (기본: Anthropic 키가 있으면 Claude) · MINUTES_MODEL (기본 claude-opus-5-5 / gpt-5-mini)
   녹음 파일은 recording-api 에만 보관하고, 처리할 때 임시 폴더에 받아 쓴 뒤 바로 지운다 */
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import { askJson, AiError } from './shorts.mjs';
import { hasFfmpeg, RAW } from './shortsAssets.mjs';
import { saveSiteSettings, sourceOf, mask } from './siteSettings.mjs';

const env = process.env;
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
const recUrl = () => String(env.RECORDING_API_URL || 'http://127.0.0.1:8790').replace(/\/+$/, '');
const recReady = () => !!env.RECORDING_API_TOKEN;
const sttModel = () => env.MINUTES_STT_MODEL || env.STT_MODEL || 'gpt-4o-mini-transcribe';
const sttReady = () => !!env.OPENAI_API_KEY;
const hasClaude = () => !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
const provider = () => (['anthropic', 'openai'].includes(env.MINUTES_PROVIDER) ? env.MINUTES_PROVIDER : hasClaude() ? 'anthropic' : 'openai');
const model = () => env.MINUTES_MODEL || (provider() === 'anthropic' ? 'claude-opus-5-5' : 'gpt-5-mini');
const aiReady = () => (provider() === 'anthropic' ? hasClaude() : !!env.OPENAI_API_KEY);
const AUTO = () => env.MINUTES_AUTO !== '0';
const DAILY = () => num(env.MINUTES_DAILY, 30);
const BACKFILL_H = () => num(env.MINUTES_BACKFILL_HOURS, 48);
const MAX_MIN = () => num(env.MINUTES_MAX_MIN, 180);
const POLL_MS = () => Math.max(15, num(env.MINUTES_POLL_SEC, 60)) * 1000;
const SEGMENT_SEC = 600;                                        // 10분씩 나눠 받아쓰기 (모델 길이 · 25MB 제한 안쪽)
const OPENAI_MAX = 24 * 1024 * 1024;
const BUSY = ['stt', 'summary'];
const CHUNK_MAX = 4 * 1024 * 1024 + 1024;                      // 조각 하나 (화면은 3MB 로 자름)
const UPLOAD_EXT = /\.(m4a|mp4|m4b|mp3|amr|awb|wav|3gp|3ga|ogg|oga|opus|aac|flac|webm|wma)$/i;            // 녹음 서버가 받는 형식과 같게
export const STATUS = { idle: '수동', queued: '대기', stt: '받아쓰는 중', summary: '정리 중', done: '완료', failed: '실패', skipped: '건너뜀' };

/** TXT 글 풀기: BOM(UTF-16 · UTF-8) → UTF-8 → 틀리면 EUC-KR/CP949 (옛 한글 메모장 · 윈도) */
export function decodeTxt(buf) {
  const b = new Uint8Array(buf);
  let t;
  if (b[0] === 0xff && b[1] === 0xfe) t = new TextDecoder('utf-16le').decode(b);
  else if (b[0] === 0xfe && b[1] === 0xff) t = new TextDecoder('utf-16be').decode(b);
  else { try { t = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { t = new TextDecoder('euc-kr').decode(b); } }
  return tidyText(t);
}
export const tidyText = t => String(t || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 400000);
const isTxt = name => /\.txt$/i.test(String(name || ''));
const baseOf = name => String(name || '').replace(/\.[^.]+$/, '').toLowerCase();
const shaOf = t => crypto.createHash('sha256').update(t).digest('hex');

class StepError extends Error { constructor(msg, status = 'failed') { super(msg); this.state = status; } }

/* ── recording-api 부르기 ── */
async function recFetch(p, { method = 'GET', timeout = 20000 } = {}) {
  if (!recReady()) throw new StepError('녹음 서버 토큰(RECORDING_API_TOKEN)이 없습니다. 녹음 서버를 설치(recording-api/deploy/update.sh)한 뒤 server/deploy/update.sh 를 다시 실행하세요');
  let r;
  try { r = await fetch(recUrl() + p, { method, headers: { Authorization: `Bearer ${env.RECORDING_API_TOKEN}` }, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new StepError(e.name === 'TimeoutError' ? '녹음 서버가 응답하지 않습니다' : '녹음 서버(jcal-recording)에 연결하지 못했습니다'); }
  if (r.status === 401) throw new StepError('녹음 서버 토큰이 맞지 않습니다 (RECORDING_API_TOKEN 확인)');
  return r;
}
const recJson = async p => { const r = await recFetch(p); if (!r.ok) throw new StepError(`녹음 서버 오류 (${r.status})`); return r.json(); };
const sqliteTime = s => (s ? new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`) : null);

/* ── 오디오 준비: ffmpeg 로 16kHz 모노 mp3 · 10분 조각 ── */
function run(cmd, args, timeout = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    p.on('error', reject);
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.trim() || `${cmd} 실패 (${code})`)); });
  });
}
async function probeSec(file) {
  try { const s = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], 60000); const n = Number(s.trim()); return Number.isFinite(n) ? n : null; }
  catch { return null; }
}
async function prepare(src, dir) {
  if (!hasFfmpeg) {
    const st = await fsp.stat(src);
    if (st.size > OPENAI_MAX) throw new StepError('서버에 ffmpeg 가 없어 큰 녹음(24MB 초과)을 나눌 수 없습니다. update.sh 를 다시 실행하세요');
    if (!/\.(mp3|m4a|wav|ogg|webm|mp4|mpeg|mpga|flac)$/i.test(src)) throw new StepError('서버에 ffmpeg 가 없어 이 형식(amr · 3gp 등)은 받아쓸 수 없습니다');
    return { parts: [src], duration: null };
  }
  const duration = await probeSec(src);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k',
    '-f', 'segment', '-segment_time', String(SEGMENT_SEC), '-reset_timestamps', '1', path.join(dir, 'part%03d.mp3')]);
  const parts = (await fsp.readdir(dir)).filter(f => /^part\d+\.mp3$/.test(f)).sort().map(f => path.join(dir, f));
  if (!parts.length) throw new StepError('녹음에서 소리를 찾지 못했습니다', 'skipped');
  return { parts, duration };
}

/* ── 받아쓰기 (OpenAI) ── */
async function transcribePart(file, prev) {
  const fd = new FormData();
  fd.append('file', new Blob([await fsp.readFile(file)], { type: 'audio/mpeg' }), path.basename(file).replace(/\.\w+$/, '') + path.extname(file));
  fd.append('model', sttModel());
  fd.append('language', 'ko');
  fd.append('response_format', 'json');
  if (prev) fd.append('prompt', prev.slice(-400));             // 앞 조각 끝부분: 이름 · 용어를 이어서 같게 적도록
  let r;
  try {
    r = await fetch(`${(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST', body: fd, signal: AbortSignal.timeout(300000), headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    });
  } catch (e) { throw new StepError(e.name === 'TimeoutError' ? '받아쓰기가 너무 오래 걸립니다' : '받아쓰기 서버에 연결하지 못했습니다'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = j.error?.code || j.error?.type || '';
    console.error('[회의록 받아쓰기]', r.status, code, j.error?.message);
    if (r.status === 401) throw new StepError('OpenAI API 키가 올바르지 않습니다 (jcal-admin ai-key 로 다시 넣기)');
    if (code === 'insufficient_quota') throw new StepError('OpenAI 크레딧(잔액)이 없습니다');
    if (r.status === 404 || code === 'model_not_found') throw new StepError(`받아쓰기 모델을 쓸 수 없습니다: ${sttModel()} (MINUTES_STT_MODEL 확인)`);
    throw new StepError(`받아쓰기 오류 (${r.status})`);
  }
  return String(j.text || '').trim();
}

/* ── 회의록 (AI, JSON 형식 고정) ── */
const KINDS = ['회의', '통화', '강의·설명', '메모', '기타'];
const S = { type: 'string' }, LIST = { type: 'array', items: S };
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'kind', 'summary', 'overview', 'agenda', 'details', 'conclusion', 'next_steps', 'etc'],
  properties: {
    title: S, kind: { type: 'string', enum: KINDS }, summary: S,
    overview: { type: 'object', additionalProperties: false, required: ['when', 'participants', 'purpose'], properties: { when: S, participants: LIST, purpose: S } },
    agenda: LIST,
    details: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['agenda', 'points'], properties: { agenda: S, points: LIST } } },
    conclusion: LIST,
    next_steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['task', 'owner', 'due', 'time'], properties: { task: S, owner: S, due: S, time: S } } },
    etc: LIST,
  },
};
const SYSTEM = `당신은 한국어 녹음(회의 · 통화 · 설명 · 메모)의 받아쓴 글을 읽고 회의록을 쓰는 비서입니다.
회의록은 다음 보고서 형식을 따릅니다: 1. 개요 · 2. 안건 · 3. 안건 별 주요 내용 · 4. 결론 · 5. 향후 진행 사항 · 6. 기타.
- title: 무엇에 관한 녹음인지 25자 안팎의 제목 (예: "홍길동 대표와 견적 일정 통화").
- kind: 회의 · 통화 · 강의·설명 · 메모 · 기타 중 하나. 두 사람이 전화로 나눈 대화면 통화.
- summary: 핵심을 한 문장으로.
- overview.when: 녹음 일시 (주어진 값을 "2026년 11월 25일(수) 오후 3:10" 처럼). overview.participants: 대화에 나온 사람 (이름을 모르면 "상대방" · "참석자 1"처럼, 파일 이름에 있는 이름은 참고). overview.purpose: 이 대화의 목적 한 문장.
- agenda: 다룬 주제를 짧은 명사구로 (보통 1~6개).
- details: 안건마다 오간 주요 내용 · 숫자 · 근거를 짧은 문장 여러 개로. agenda 와 같은 순서 · 같은 이름.
- conclusion: 결정되거나 합의된 것. 결정된 것이 없으면 "결정된 사항 없음" 한 줄.
- next_steps: 해야 할 일. task 는 "무엇을 · 얼마나"가 분명하게, owner 는 맡은 사람 (모르면 빈 문자열, 녹음한 본인이면 "나"),
  due 는 YYYY-MM-DD (녹음 날짜를 기준으로 "내일" · "다음 주 화요일"을 실제 날짜로 바꿈, 기한이 없으면 빈 문자열), time 은 HH:MM 또는 빈 문자열.
- etc: 위에 넣기 애매하지만 알아 둘 것 (연락처 확인 필요 · 금액 · 주의할 점 등). 없으면 빈 배열.
- 받아쓴 글에는 잘못 알아들은 단어가 섞여 있을 수 있습니다. 문맥으로 바로잡되, 글에 없는 사실은 지어내지 않습니다.
- 존댓말이 아닌 보고서체(~함, ~하기로 함)로 간결하게 씁니다. 정해진 JSON 형식으로만 답합니다.`;
const kst = d => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
const kstDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const cleanList = (a, n = 30, len = 400) => (Array.isArray(a) ? a : []).map(x => clean(x, len)).filter(Boolean).slice(0, n);

export function tidyMinutes(m) {
  const o = m?.overview || {};
  return {
    title: clean(m?.title, 80) || '제목 없는 녹음', kind: KINDS.includes(m?.kind) ? m.kind : '기타', summary: clean(m?.summary, 300),
    overview: { when: clean(o.when, 60), participants: cleanList(o.participants, 20, 60), purpose: clean(o.purpose, 300) },
    agenda: cleanList(m?.agenda, 15, 120),
    details: (Array.isArray(m?.details) ? m.details : []).map(d => ({ agenda: clean(d?.agenda, 120), points: cleanList(d?.points, 20) })).filter(d => d.agenda || d.points.length).slice(0, 15),
    conclusion: cleanList(m?.conclusion, 20),
    next_steps: (Array.isArray(m?.next_steps) ? m.next_steps : []).map(x => ({ task: clean(x?.task, 200), owner: clean(x?.owner, 40), due: okDate(x?.due) ? x.due : '', time: /^\d{2}:\d{2}$/.test(String(x?.time)) ? x.time : '' })).filter(x => x.task).slice(0, 30),
    etc: cleanList(m?.etc, 20),
  };
}

/* ── 이미 정리된 회의록 (Word · TXT) 을 AI 없이 1. 개요 ~ 6. 기타로 나누기 ── */
const SECS = [
  ['details', /^(안건\s*별\s*(주요\s*)?내용|안건별\s*(주요\s*)?내용|주요\s*(논의\s*)?내용|논의\s*내용|회의\s*내용|세부\s*내용)/],
  ['overview', /^(회의\s*)?개요$|^개요/],
  ['agenda', /^(안건|의제|회의\s*안건|주제)$/],
  ['conclusion', /^(결론|결정\s*사항|합의\s*사항|결정\s*및\s*합의)/],
  ['next', /^(향후\s*(진행\s*)?(사항|계획|일정)?|후속\s*(조치|사항)|할\s*일|조치\s*사항|action\s*items?)/i],
  ['etc', /^(기타|비고|참고\s*사항?)$/],
];
const BULLET = /^\s*(?:[-*•·▪◦○●□■◆◇▶►※✓✔]|\(?\d{1,2}[.)]|\(?[가-하][.)]|[①-⑳])\s*/;
function headingOf(line) {
  const raw = line.trim();
  if (!raw || raw.length > 40) return null;
  const marked = /^(#{1,6}\s*|\[|【|<|(?:\d{1,2}|[IVX]{1,4}|[가-하])\s*[.)．]\s*|[□■◆●▶]\s*)/.test(raw) || /[:：]$/.test(raw);
  const t = raw.replace(/^#{1,6}\s*/, '').replace(/^[\[【<]\s*/, '').replace(/^(?:\d{1,2}|[IVX]{1,4}|[가-하])\s*[.)．]\s*/, '').replace(/^[□■◆●▶]\s*/, '')
    .replace(/\s*[\]】>]\s*$/, '').replace(/\s*[:：]\s*$/, '').trim();
  if (!t || t.length > 20) return null;
  for (const [k, re] of SECS) if (re.test(t) && (marked || t.length <= 10)) return k;
  return null;
}
export function looksLikeMinutes(text) {
  const found = new Set();
  for (const l of String(text || '').split('\n').slice(0, 400)) { const h = headingOf(l); if (h) found.add(h); }
  return found.size >= 2 || (found.size >= 1 && /회의록/.test(String(text).slice(0, 300)));
}
const strip = l => l.replace(BULLET, '').trim();
function dueOf(s, base) {
  let m = s.match(/(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  let y, mo, d;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/(?:^|[^\d])(\d{1,2})\s*[/.월]\s*(\d{1,2})\s*일?(?!\d)/))) { y = (base || new Date()).getFullYear(); [mo, d] = [Number(m[1]), Number(m[2])]; }
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function parseMinutesText(text, { name = '', at = null } = {}) {
  const lines = String(text || '').split('\n').map(l => l.replace(/\t/g, ' ').replace(/\s+$/, ''));
  const sec = { pre: [], overview: [], agenda: [], details: [], conclusion: [], next: [], etc: [] };
  let cur = 'pre';
  for (const l of lines) { const h = headingOf(l); if (h) { cur = h; continue; } if (l.trim()) sec[cur].push(l); }
  const base = at ? new Date(at) : null;
  const titleLine = sec.pre.map(strip).find(l => l && !/^(일시|날짜|장소|참석|작성)/.test(l));
  const fileTitle = String(name).replace(/\.[^.]+$/, '').replace(/(?:^|[_ -])(20)?\d{6}[_ -]?\d{0,6}/g, ' ').trim();
  const ov = { when: '', participants: [], purpose: '' };
  for (const l of [...sec.pre, ...sec.overview]) {
    const s = strip(l), kv = s.match(/^(일\s*시|날\s*짜|일자|시간|참\s*석\s*자?|참여자|목\s*적|장\s*소|주\s*제)\s*[:：]?\s*(.+)$/);
    if (kv) {
      const k = kv[1].replace(/\s/g, '');
      if (/일시|날짜|일자|시간/.test(k)) ov.when = ov.when || kv[2];
      else if (/참석|참여/.test(k)) ov.participants.push(...kv[2].split(/[,、·/]|\s{2,}/).map(x => x.trim()).filter(Boolean));
      else if (/목적|주제/.test(k)) ov.purpose = ov.purpose || kv[2];
    } else if (sec.overview.includes(l) && s) ov.purpose = ov.purpose ? `${ov.purpose} ${s}` : s;
  }
  const details = [];
  for (const l of sec.details) {
    const isSub = /^\S/.test(l) && /^\s*(\d{1,2}[.)]|[가-하][.)]|[①-⑳]|\[)/.test(l) && strip(l).length <= 60;
    if (isSub || !details.length) details.push({ agenda: isSub ? strip(l).replace(/[\]】]$/, '') : '주요 내용', points: isSub ? [] : [strip(l)] });
    else details[details.length - 1].points.push(strip(l));
  }
  const next_steps = sec.next.map(strip).filter(Boolean).map(s => {
    const ow = s.match(/(?:담당(?:자)?|책임)\s*[:：]?\s*([가-힣A-Za-z]{2,10})/) || s.match(/\(([가-힣]{2,4})\)/);
    const tm = s.match(/(\d{1,2}):(\d{2})/);
    return { task: s, owner: ow ? ow[1] : '', due: dueOf(s, base), time: tm ? `${tm[1].padStart(2, '0')}:${tm[2]}` : '' };
  });
  const conclusion = sec.conclusion.map(strip).filter(Boolean);
  const all = String(text);
  return {
    title: (titleLine && titleLine.replace(/^회의록\s*[:：-]?\s*/, '').slice(0, 80)) || fileTitle || '올린 회의록',
    kind: /통화|전화/.test(all.slice(0, 2000)) ? '통화' : /회의|미팅|협의/.test(all.slice(0, 2000)) ? '회의' : '메모',
    summary: (conclusion[0] || ov.purpose || details[0]?.points[0] || sec.pre.map(strip).find(Boolean) || '').slice(0, 300),
    overview: ov,
    agenda: sec.agenda.map(strip).filter(Boolean),
    details, conclusion, next_steps,
    etc: sec.etc.map(strip).filter(Boolean),
  };
}
/** 올린 회의록 → 저장할 회의록 (원문도 같이, AI 안 씀) */
export function fileMinutes(text, opt) { return { ...tidyMinutes(parseMinutesText(text, opt)), raw: String(text).slice(0, 200000), source: 'file' }; }
const FILE_AI = '올린 회의록 (AI 안 씀)';

async function summarize(row, transcript) {
  const at = row.recorded_at || row.uploaded_at || new Date();
  const prompt = `[녹음 정보]
- 녹음 일시: ${kst(new Date(at))} (날짜 기준: ${kstDate(new Date(at))})
- 파일 이름: ${row.filename || '없음'}
- 기기: ${row.device === 'txt' ? '없음 (TXT 파일로 올린 글)' : row.device || '없음'}${row.duration ? `\n- 길이: 약 ${Math.max(1, Math.round(Number(row.duration) / 60))}분` : ''}

[${row.has_text ? '올린 글 (받아 적은 글 또는 메모)' : '받아쓴 글'}]
${transcript}`;
  try { return tidyMinutes(await askJson(prompt, { system: SYSTEM, schema: SCHEMA, name: 'meeting_minutes', provider: provider(), model: model() })); }
  catch (e) { if (e instanceof AiError) throw new StepError(e.message); console.error('[회의록 AI]', e); throw new StepError('AI 회의록을 받지 못했습니다'); }
}

/* ── 목록 · 대기열 ── */
const listOut = r => ({
  id: Number(r.rec_id), filename: r.filename, device: r.device, size: Number(r.size_bytes), at: r.recorded_at || r.uploaded_at, uploadedAt: r.uploaded_at,
  status: r.status, error: r.error || '', duration: r.duration == null ? null : Number(r.duration),
  title: r.minutes?.title || '', kind: r.minutes?.kind || '', people: (r.minutes?.overview?.participants || []).join(', '), summary: r.minutes?.summary || '', steps: r.minutes?.next_steps?.length || 0,
  sttModel: r.stt_model || '', aiModel: r.ai_model || '', processedAt: r.processed_at,
  hasText: !!r.has_text, audio: Number(r.rec_id) > 0 && !isTxt(r.filename) && !/\.(docx|md)$/i.test(r.filename), fromFile: r.minutes?.source === 'file',
});


/* ── 사이트에서 하는 설정 (관리자) ── */
export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (기본 · 가장 정확)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (비용 절반)' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (아주 저렴 · 짧은 통화용)' },
];
export const STT_MODELS = [
  { id: 'gpt-4o-mini-transcribe', name: 'gpt-4o-mini-transcribe (기본 · 분당 약 $0.003)' },
  { id: 'gpt-4o-transcribe', name: 'gpt-4o-transcribe (더 정확 · 분당 약 $0.006)' },
];
const publicUrl = () => String(env.RECORDING_PUBLIC_URL || 'https://rec-31-97-71-87.sslip.io').replace(/\/+$/, '');
async function checkOpenAI(key) {
  let r;
  try { r = await fetch(`${(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }); }
  catch { return { ok: null, msg: 'OpenAI 에 연결하지 못해 확인은 못 했습니다 (저장은 함)' }; }
  if (r.status === 401) return { ok: false, msg: 'OpenAI 가 이 키를 거절했습니다. platform.openai.com › API keys 에서 다시 복사해 주세요' };
  return r.ok ? { ok: true } : { ok: null, msg: `OpenAI 확인 중 오류 (${r.status}) · 저장은 함` };
}
async function checkAnthropic(key) {
  let Anthropic;
  try { Anthropic = (await import('@anthropic-ai/sdk')).default; } catch { return { ok: null, msg: 'Claude 라이브러리가 없어 확인은 못 했습니다 (저장은 함)' }; }
  try { await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15000 }).models.list({ limit: 1 }); return { ok: true }; }
  catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, msg: 'Anthropic 이 이 키를 거절했습니다. console.anthropic.com › API Keys 에서 다시 복사해 주세요' };
    return { ok: null, msg: `Anthropic 확인 중 오류 (${e.status ?? '연결'}) · 저장은 함` };
  }
}
async function recCheck() {
  const out = { url: recUrl(), health: false, auth: false, total: null, msg: '' };
  try { const r = await fetch(`${recUrl()}/api/health`, { signal: AbortSignal.timeout(5000) }); out.health = r.ok; } catch { /* 꺼짐 */ }
  if (!out.health) { out.msg = '녹음 서버가 응답하지 않습니다 (아직 설치 전이거나 꺼져 있음)'; return out; }
  if (!recReady()) { out.msg = '녹음 서버는 켜져 있지만 토큰이 없습니다'; return out; }
  try { const j = await recJson('/api/recordings?limit=1'); out.auth = true; out.total = j.total; }
  catch (e) { out.msg = e.message; }
  return out;
}

export function minutesModule({ pool, adminUser, HttpError }) {
  let busy = false, lastSync = 0, timer = null, syncing = null;
  let recState = { ok: false, total: null, msg: '아직 녹음 서버를 확인하지 않았습니다', at: null };   // 화면 진단용: 마지막 목록 확인 결과
  const ups = new Map();                                        // 올리는 중인 파일: u → { next, size, at }
  setInterval(() => { for (const [u, v] of ups) if (Date.now() - v.at > 3600e3) { ups.delete(u); fsp.rm(path.join(os.tmpdir(), `jcal-up-${u}`), { force: true }).catch(() => {}); } }, 600e3).unref();

  const doSync = async () => {
    try {
      if (!recReady()) { recState = { ok: false, total: null, msg: '녹음 서버 토큰이 없습니다 (설정 창에서 넣기)', at: new Date() }; return; }
      const j = await recJson('/api/recordings?limit=200');
      let version = '';
      try { version = (await (await fetch(`${recUrl()}/api/health`, { signal: AbortSignal.timeout(5000) })).json()).version || ''; } catch { /* 옛 녹음 서버 */ }
      let errors = [];
      if (version) { try { errors = ((await recJson('/api/recent-errors')).items || []).filter(e => Date.now() - new Date(e.at) < 48 * 3600e3).slice(0, 5); } catch { /* 1.3.0 전 녹음 서버 */ } }
      recState = { ok: true, total: Number(j.total) || 0, msg: '', at: new Date(), version, errors };
      const items = [...(j.items || [])];
      // 녹음 서버에 200건이 넘게 있고 아직 다 받지 않았으면 나머지도 (예전 녹음을 한꺼번에 보낸 경우)
      const known = (await pool.query('SELECT count(*)::int AS n FROM jcal.recording_minutes WHERE rec_id > 0')).rows[0].n;
      for (let off = 200; off < recState.total && known < recState.total && off < 20000; off += 500) items.push(...((await recJson(`/api/recordings?limit=500&offset=${off}`)).items || []));
      const fresh = Date.now() - BACKFILL_H() * 3600e3;
      for (const it of items) {
        const up = sqliteTime(it.uploaded_at), rec = it.recorded_at ? new Date(it.recorded_at) : null;
        const auto = AUTO() && up && up.getTime() >= fresh;
        // 같은 id 인데 파일 내용(sha256)이 다르면 녹음 서버를 새로 만든 것 → 새 녹음으로 본다
        await pool.query(`INSERT INTO jcal.recording_minutes (rec_id, sha256, device, filename, size_bytes, recorded_at, uploaded_at, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (rec_id) DO UPDATE SET device = EXCLUDED.device, filename = EXCLUDED.filename, size_bytes = EXCLUDED.size_bytes, recorded_at = EXCLUDED.recorded_at, uploaded_at = EXCLUDED.uploaded_at,
            sha256 = EXCLUDED.sha256,
            status = CASE WHEN jcal.recording_minutes.sha256 <> EXCLUDED.sha256 THEN EXCLUDED.status ELSE jcal.recording_minutes.status END,
            transcript = CASE WHEN jcal.recording_minutes.sha256 <> EXCLUDED.sha256 THEN '' ELSE jcal.recording_minutes.transcript END,
            minutes = CASE WHEN jcal.recording_minutes.sha256 <> EXCLUDED.sha256 THEN NULL ELSE jcal.recording_minutes.minutes END,
            updated_at = CASE WHEN jcal.recording_minutes.sha256 <> EXCLUDED.sha256 THEN now() ELSE jcal.recording_minutes.updated_at END`,
        [it.id, String(it.sha256 || ''), String(it.device || '').slice(0, 60), String(it.filename || ''), Number(it.size) || 0, rec && !Number.isNaN(rec.getTime()) ? rec : null, up, auto ? 'queued' : 'idle']);
      }
      lastSync = Date.now();
    } catch (e) {
      recState = { ok: false, total: null, msg: e instanceof StepError ? e.message : '녹음 서버 목록을 받지 못했습니다', at: new Date() };
      if (!(e instanceof StepError)) console.error('[회의록 목록]', e); else console.warn('[회의록 목록]', e.message); lastSync = Date.now();
    }
  };
  const syncList = () => { if (!syncing) syncing = doSync().finally(() => { syncing = null; }); return syncing; };

  const doneToday = async () => (await pool.query("SELECT count(*)::int AS n FROM jcal.recording_minutes WHERE processed_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AND auto_run")).rows[0].n;
  const setRow = (id, f) => {
    const keys = Object.keys(f);
    return pool.query(`UPDATE jcal.recording_minutes SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE rec_id = $1`, [id, ...keys.map(k => f[k])]);
  };

  async function processOne(row) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jcal-minutes-'));
    try {
      if (row.rec_id < 0 && !row.has_text && row.minutes?.raw) {   // 올린 회의록(Word 등)을 AI 로 다시 정리: 원문을 전문으로 남김
        Object.assign(row, { transcript: row.minutes.raw, has_text: true });
        await setRow(row.rec_id, { transcript: row.transcript, has_text: true });
      }
      if (row.rec_id > 0 && isTxt(row.filename) && !row.has_text) {   // 휴대폰이 보낸 TXT: 녹음 서버에서 받아 글로
        const r = await recFetch(`/api/recordings/${row.rec_id}/file`, { timeout: 120000 });
        if (r.status === 404) throw new StepError('녹음 서버에 파일이 없습니다 (지워졌을 수 있음)', 'skipped');
        if (!r.ok) throw new StepError(`TXT 파일을 받지 못했습니다 (${r.status})`);
        const text = decodeTxt(await r.arrayBuffer());
        if (text.replace(/\s/g, '').length < 5) throw new StepError('글이 거의 없는 파일입니다', 'skipped');
        if (looksLikeMinutes(text)) {                             // 이미 정리된 회의록: AI 없이 그대로 (같은 이름 녹음이 회의록 전이면 그 녹음에)
          const mins = JSON.stringify(fileMinutes(text, { name: row.filename, at: row.recorded_at || row.uploaded_at }));
          const { rows: [au] } = await pool.query(`SELECT rec_id, filename FROM jcal.recording_minutes WHERE rec_id > 0 AND rec_id <> $1 AND filename !~* '\\.txt$'
            AND lower(regexp_replace(filename, '\\.[^.]+$', '')) = $2 AND status IN ('idle', 'queued', 'failed', 'skipped') ORDER BY rec_id DESC LIMIT 1`, [row.rec_id, baseOf(row.filename)]);
          const target = au ? au.rec_id : row.rec_id;
          await setRow(target, { status: 'done', minutes: mins, stt_model: 'TXT', ai_model: FILE_AI, processed_at: new Date(), error: '', text_sha256: shaOf(text) });
          if (au) throw new StepError(`녹음(${au.filename})에 회의록으로 붙였습니다`, 'skipped');
          return;
        }
        await setRow(row.rec_id, { transcript: text, has_text: true, text_sha256: shaOf(text), stt_model: 'TXT' });
        Object.assign(row, { transcript: text, has_text: true });
        // 같은 이름의 녹음: 회의록 전이면 그 녹음에 글을 붙이고 (받아쓰기 안 함) 이 TXT 는 건너뜀, 이미 끝났으면 이 TXT 만 건너뜀
        const { rows: [au] } = await pool.query(`SELECT rec_id, filename, status FROM jcal.recording_minutes WHERE rec_id > 0 AND rec_id <> $1 AND filename !~* '\\.txt$'
          AND lower(regexp_replace(filename, '\\.[^.]+$', '')) = $2 ORDER BY rec_id DESC LIMIT 1`, [row.rec_id, baseOf(row.filename)]);
        if (au && (au.status === 'done' || BUSY.includes(au.status))) throw new StepError(`같은 이름의 녹음(${au.filename})으로 회의록을 만들었습니다`, 'skipped');
        if (au) {
          await pool.query(`UPDATE jcal.recording_minutes SET transcript = $2, has_text = true, stt_model = 'TXT', status = 'queued', error = '', updated_at = now() WHERE rec_id = $1`, [au.rec_id, text]);
          throw new StepError(`녹음(${au.filename})에 글을 붙였습니다 (회의록은 그 녹음에)`, 'skipped');
        }
      }
      if (row.rec_id > 0 && !isTxt(row.filename) && !row.has_text) {   // 녹음: 휴대폰이 같은 이름의 TXT 도 보냈으면 그 글을 씀
        const { rows: [tx] } = await pool.query(`SELECT rec_id, filename, transcript FROM jcal.recording_minutes WHERE rec_id > 0 AND filename ~* '\\.txt$'
          AND lower(regexp_replace(filename, '\\.[^.]+$', '')) = $1 AND status NOT IN ('stt', 'summary') ORDER BY rec_id DESC LIMIT 1`, [baseOf(row.filename)]);
        if (tx) {
          let text = tx.transcript;
          if (!text) { const r = await recFetch(`/api/recordings/${tx.rec_id}/file`, { timeout: 120000 }).catch(() => null); if (r?.ok) text = decodeTxt(await r.arrayBuffer()); }
          if (text && looksLikeMinutes(text)) {                      // 같은 이름 TXT 가 이미 정리된 회의록이면 그대로 (AI 안 씀)
            await setRow(row.rec_id, { status: 'done', minutes: JSON.stringify(fileMinutes(text, { name: tx.filename, at: row.recorded_at || row.uploaded_at })), stt_model: 'TXT', ai_model: FILE_AI, processed_at: new Date(), error: '' });
            await setRow(tx.rec_id, { status: 'skipped', error: `녹음(${row.filename})에 회의록으로 붙였습니다`, processed_at: new Date() });
            return;
          }
          if (text && text.replace(/\s/g, '').length >= 5) {
            await setRow(row.rec_id, { transcript: text, has_text: true, stt_model: 'TXT' });
            Object.assign(row, { transcript: text, has_text: true });
            await setRow(tx.rec_id, { status: 'skipped', error: `녹음(${row.filename})에 붙여 회의록을 만들었습니다`, processed_at: new Date() });
          }
        }
      }
      if (row.has_text && row.transcript) {                     // TXT 로 올린 글: 받아쓰기 없이 바로 회의록
        if (!aiReady()) throw new StepError('회의록 AI 키가 없습니다 (설정 창에서 Anthropic 키 넣기)');
        await setRow(row.rec_id, { status: 'summary', error: '' });
        const minutes = await summarize(row, row.transcript);
        await setRow(row.rec_id, { status: 'done', stt_model: 'TXT', minutes: JSON.stringify(minutes), ai_model: `${provider() === 'anthropic' ? 'Claude' : 'ChatGPT'} · ${model()}`, processed_at: new Date(), error: '' });
        return;
      }
      if (!sttReady()) throw new StepError('받아쓰기에 OpenAI API 키가 필요합니다 (VPS 에서 jcal-admin ai-key)');
      if (!aiReady()) throw new StepError('회의록 AI 키가 없습니다 (VPS 에서 jcal-admin ai-key 로 Anthropic 키 넣기)');
      await setRow(row.rec_id, { status: 'stt', error: '' });
      const ext = (path.extname(row.filename || '').toLowerCase().match(/^\.\w{1,5}$/) || ['.m4a'])[0];
      const src = path.join(dir, `source${ext}`);
      const r = await recFetch(`/api/recordings/${row.rec_id}/file`, { timeout: 10 * 60 * 1000 });
      if (r.status === 404) throw new StepError('녹음 서버에 파일이 없습니다 (지워졌을 수 있음)', 'skipped');
      if (!r.ok || !r.body) throw new StepError(`녹음 파일을 받지 못했습니다 (${r.status})`);
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(src));
      const { parts, duration } = await prepare(src, dir);
      if (duration != null) await setRow(row.rec_id, { duration });
      if (row.auto_run && duration && duration > MAX_MIN() * 60) throw new StepError(`${MAX_MIN()}분이 넘는 녹음은 자동으로 만들지 않습니다. "회의록 만들기"를 누르세요`, 'idle');
      if (duration != null && duration < 3) throw new StepError('녹음이 너무 짧습니다', 'skipped');
      let text = '';
      for (const p of parts) { const t = await transcribePart(p, text); if (t) text += (text ? '\n' : '') + t; }
      text = text.slice(0, 400000);
      if (text.replace(/\s/g, '').length < 5) throw new StepError('말소리를 알아듣지 못했습니다', 'skipped');
      await setRow(row.rec_id, { status: 'summary', transcript: text, stt_model: sttModel() });
      const minutes = await summarize({ ...row, duration }, text);
      await setRow(row.rec_id, { status: 'done', minutes: JSON.stringify(minutes), ai_model: `${provider() === 'anthropic' ? 'Claude' : 'ChatGPT'} · ${model()}`, processed_at: new Date(), error: '' });
    } catch (e) {
      const msg = e instanceof StepError ? e.message : '처리 중 오류가 났습니다';
      if (!(e instanceof StepError)) console.error('[회의록]', row.rec_id, e);
      await setRow(row.rec_id, { status: e.state || 'failed', error: msg, processed_at: new Date() }).catch(() => {});
    } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }

  async function drain() {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        // 버튼으로 요청한 것(manual)이 먼저, 자동은 하루 한도 안에서
        const cap = (await doneToday()) < DAILY();
        const { rows } = await pool.query(`UPDATE jcal.recording_minutes SET status = 'stt', updated_at = now() WHERE rec_id = (
            SELECT rec_id FROM jcal.recording_minutes WHERE status = 'queued' AND (NOT auto_run OR $1) ORDER BY auto_run, coalesce(recorded_at, uploaded_at) LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING *`, [cap]);
        if (!rows[0]) break;
        await processOne(rows[0]);
      }
    } catch (e) { console.error('[회의록 대기열]', e); }
    finally { busy = false; }
  }
  const tick = async () => { await syncList(); await drain(); };

  const routes = {
    'GET /api/minutes/settings': async req => {
      await adminUser(req);
      const key = k => ({ set: !!env[k], masked: mask(env[k] || ''), from: sourceOf(k) });
      return {
        openai: key('OPENAI_API_KEY'), anthropic: key('ANTHROPIC_API_KEY'),
        recording: { ...(await recCheck()), uploadUrl: `${publicUrl()}/api/recordings/raw`, token: env.RECORDING_API_TOKEN || '', tokenFrom: sourceOf('RECORDING_API_TOKEN') },
        model: model(), models: MODELS, provider: provider(), sttModel: sttModel(), sttModels: STT_MODELS, auto: AUTO(), daily: DAILY(),
      };
    },
    'POST /api/minutes/settings': async (req, body) => {
      await adminUser(req);
      const ch = {}, notes = [];
      const clear = Array.isArray(body.clear) ? body.clear : [];
      if (clear.includes('openai')) ch.OPENAI_API_KEY = null;
      if (clear.includes('anthropic')) ch.ANTHROPIC_API_KEY = null;
      if (clear.includes('recToken')) ch.RECORDING_API_TOKEN = null;
      const oa = String(body.openaiKey || '').trim(), an = String(body.anthropicKey || '').trim(), rt = String(body.recToken || '').trim();
      if (oa) {
        if (/^sk-ant-/.test(oa) || !/^sk-[\w-]{20,}$/.test(oa)) throw new HttpError(400, 'OpenAI 키 형식이 아닙니다 (sk- 또는 sk-proj- 로 시작)');
        const c = await checkOpenAI(oa); if (c.ok === false) throw new HttpError(400, c.msg); if (c.msg) notes.push(c.msg);
        ch.OPENAI_API_KEY = oa;
      }
      if (an) {
        if (!/^sk-ant-[\w-]{20,}$/.test(an)) throw new HttpError(400, 'Anthropic 키 형식이 아닙니다 (sk-ant- 로 시작)');
        const c = await checkAnthropic(an); if (c.ok === false) throw new HttpError(400, c.msg); if (c.msg) notes.push(c.msg);
        ch.ANTHROPIC_API_KEY = an;
      }
      if (rt) { if (!/^[\w-]{16,200}$/.test(rt)) throw new HttpError(400, '녹음 서버 토큰 형식이 아닙니다'); ch.RECORDING_API_TOKEN = rt; }
      if (body.model !== undefined) { if (!MODELS.some(m => m.id === body.model)) throw new HttpError(400, '고를 수 없는 모델입니다'); ch.MINUTES_MODEL = body.model; }
      if (body.sttModel !== undefined) { if (!STT_MODELS.some(m => m.id === body.sttModel)) throw new HttpError(400, '고를 수 없는 받아쓰기 모델입니다'); ch.MINUTES_STT_MODEL = body.sttModel; }
      if (body.auto !== undefined) ch.MINUTES_AUTO = body.auto ? '1' : '0';
      try { saveSiteSettings(ch); } catch (e) { console.error('[사이트 설정] 저장 실패', e); throw new HttpError(500, '서버에 설정을 저장하지 못했습니다 (상태 폴더 권한 확인)'); }
      if (ch.RECORDING_API_TOKEN !== undefined || ch.OPENAI_API_KEY || ch.ANTHROPIC_API_KEY) { lastSync = 0; tick().catch(() => {}); }   // 바로 새 녹음 확인 · 실패했던 것은 화면에서 다시 시도
      return { ok: true, notes };
    },
    'GET /api/minutes': async req => {
      await adminUser(req);
      if (Date.now() - lastSync > 15000) {                         // 화면이 볼 때마다 새 녹음 확인 (처음 한 번은 기다려서 바로 보이게)
        const p = syncList().then(drain).catch(() => {});
        if (!recState.at) await Promise.race([syncList(), new Promise(r => setTimeout(r, 8000))]);
        void p;
      }
      const { rows } = await pool.query('SELECT rec_id, filename, device, size_bytes, recorded_at, uploaded_at, status, error, duration, minutes, stt_model, ai_model, processed_at, has_text FROM jcal.recording_minutes ORDER BY coalesce(recorded_at, uploaded_at) DESC NULLS LAST, rec_id DESC LIMIT 3000');
      return {
        ready: { api: recReady(), stt: sttReady(), ai: aiReady(), ffmpeg: hasFfmpeg }, auto: AUTO(), rec: { ...recState, url: recUrl() }, today: await doneToday(), limit: DAILY(),
        model: { stt: sttModel(), ai: `${provider() === 'anthropic' ? 'Claude' : 'ChatGPT'} · ${model()}` }, items: rows.map(listOut),
      };
    },
    'GET /api/minutes/item': async req => {
      await adminUser(req);
      const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
      const { rows } = await pool.query('SELECT * FROM jcal.recording_minutes WHERE rec_id = $1', [id]);
      if (!rows[0]) throw new HttpError(404, '없는 녹음입니다');
      return { item: { ...listOut(rows[0]), transcript: rows[0].transcript || '', minutes: rows[0].minutes || null } };
    },
    /** 회의록 대시보드: 건수 · 종류 · 월별 · 할 일 모음 · 자주 만난 사람 · 최근 회의록 */
    'GET /api/minutes/dashboard': async req => {
      await adminUser(req);
      const { rows } = await pool.query(`SELECT rec_id, filename, coalesce(recorded_at, uploaded_at) AS at, minutes FROM jcal.recording_minutes
        WHERE status = 'done' AND minutes IS NOT NULL ORDER BY coalesce(recorded_at, uploaded_at) DESC NULLS LAST LIMIT 5000`);
      const today = kstDate(new Date()), month = today.slice(0, 7);
      const wk = new Date(`${today}T00:00:00+09:00`); wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
      const kinds = {}, months = {}, people = {}, tasks = [], doneList = [];   // doneList: 끝낸 할 일 (엑셀 · 월 보기용)
      let thisMonth = 0, thisWeek = 0, doneTasks = 0;
      for (const r of rows) {
        const m = r.minutes, at = r.at ? new Date(r.at) : null, d = at ? kstDate(at) : '';
        kinds[m.kind || '기타'] = (kinds[m.kind || '기타'] || 0) + 1;
        if (d) { months[d.slice(0, 7)] = (months[d.slice(0, 7)] || 0) + 1; if (d.startsWith(month)) thisMonth++; if (at >= wk) thisWeek++; }
        for (const p of m.overview?.participants || []) { const k = String(p).trim(); if (k && !/^(나|본인|상대방|참석자\s*\d*|확인 필요)$/.test(k)) people[k] = (people[k] || 0) + 1; }
        const doneSet = new Set(Array.isArray(m.done_steps) ? m.done_steps : []);
        (m.next_steps || []).forEach((x, i) => {
          if (doneSet.has(i)) { doneTasks++; doneList.push({ id: Number(r.rec_id), i, title: m.title || r.filename, task: x.task, owner: x.owner || '', due: x.due || '', time: x.time || '', at: r.at, done: true }); return; }
          tasks.push({ id: Number(r.rec_id), i, title: m.title || r.filename, task: x.task, owner: x.owner || '', due: x.due || '', time: x.time || '', at: r.at });
        });
      }
      tasks.sort((a, b) => (a.due || '9999') .localeCompare(b.due || '9999') || String(b.at).localeCompare(String(a.at)));
      const last12 = [];
      for (let i = 11; i >= 0; i--) { const t = new Date(`${month}-01T00:00:00+09:00`); t.setMonth(t.getMonth() - i); const k = kstDate(t).slice(0, 7); last12.push({ month: k, n: months[k] || 0 }); }
      return {
        total: rows.length, thisMonth, thisWeek, today,
        tasks: { open: tasks.length, done: doneTasks, overdue: tasks.filter(t => t.due && t.due < today).length, list: tasks.slice(0, 3000), doneList: doneList.slice(0, 3000) },
        kinds: Object.entries(kinds).map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n),
        months: last12,
        people: Object.entries(people).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 15),
        // 의사결정 모음 (회의록 "4. 결론"): 화면이 월별로 골라 엑셀로
        decisions: rows.filter(r => (r.minutes.conclusion || []).some(c => !/^결정된 사항 없음/.test(c))).slice(0, 3000).map(r => ({
          id: Number(r.rec_id), at: r.at, title: r.minutes.title || r.filename, kind: r.minutes.kind || '', when: r.minutes.overview?.when || '',
          participants: (r.minutes.overview?.participants || []).join(', '), purpose: r.minutes.overview?.purpose || '', agenda: (r.minutes.agenda || []).join(', '),
          conclusion: (r.minutes.conclusion || []).filter(c => !/^결정된 사항 없음/.test(c)), steps: (r.minutes.next_steps || []).length, source: r.minutes.source === 'file' ? '올린 회의록' : 'AI 회의록',
        })),
        recent: rows.slice(0, 8).map(r => ({ id: Number(r.rec_id), title: r.minutes.title || r.filename, kind: r.minutes.kind || '', summary: r.minutes.summary || '', at: r.at, steps: (r.minutes.next_steps || []).length })),
      };
    },
    /** 할 일 끝냄 표시 (회의록 안 next_steps 순번) */
    'POST /api/minutes/step': async (req, body) => {
      await adminUser(req);
      const id = Number(body.id), i = Number(body.i);
      if (!Number.isInteger(id) || !Number.isInteger(i) || i < 0 || i > 100) throw new HttpError(400, '할 일 정보가 올바르지 않습니다');
      const { rows: [r] } = await pool.query('SELECT minutes FROM jcal.recording_minutes WHERE rec_id = $1', [id]);
      if (!r?.minutes) throw new HttpError(404, '없는 회의록입니다');
      const set = new Set(Array.isArray(r.minutes.done_steps) ? r.minutes.done_steps : []);
      if (body.done) set.add(i); else set.delete(i);
      await pool.query(`UPDATE jcal.recording_minutes SET minutes = jsonb_set(minutes, '{done_steps}', $2::jsonb), updated_at = now() WHERE rec_id = $1`, [id, JSON.stringify([...set].sort((a, b) => a - b))]);
      return { ok: true, done: [...set] };
    },
    'POST /api/minutes/process': async (req, body) => {
      await adminUser(req);
      const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(Number).filter(n => Number.isInteger(n) && n !== 0).slice(0, 1000);
      const { rowCount } = await pool.query(`UPDATE jcal.recording_minutes SET status = 'queued', auto_run = false, error = '', updated_at = now() WHERE rec_id = ANY($1::bigint[]) AND status NOT IN ('stt', 'summary')`, [ids]);
      if (!rowCount) throw new HttpError(409, '이미 처리 중이거나 없는 녹음입니다');
      drain();
      return { ok: true, queued: rowCount };
    },

    'POST /api/minutes/delete': async (req, body) => {
      await adminUser(req);
      const id = Number(body.id);
      const { rows } = await pool.query('SELECT status FROM jcal.recording_minutes WHERE rec_id = $1', [id]);
      if (!rows[0]) throw new HttpError(404, '없는 녹음입니다');
      if (BUSY.includes(rows[0].status)) throw new HttpError(409, '처리 중에는 지울 수 없습니다. 끝난 뒤 다시 시도하세요');
      if (id > 0) {                                               // 음수 = TXT 로 올린 글 (녹음 서버에 없음)
        const r = await recFetch(`/api/recordings/${id}`, { method: 'DELETE' }).catch(e => { throw new HttpError(502, e.message); });
        if (!r.ok && r.status !== 404) throw new HttpError(502, `녹음 서버에서 지우지 못했습니다 (${r.status})`);
      }
      await pool.query('DELETE FROM jcal.recording_minutes WHERE rec_id = $1', [id]);
      return { ok: true };
    },
    /** 예전 TXT 올리기 (화면이 한글 인코딩을 풀어 글로 보냄) */
    'POST /api/minutes/text': async (req, body) => {
      await adminUser(req);
      const name = path.basename(String(body.name || '')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200);
      if (!/\.(txt|md|docx)$/i.test(name)) throw new HttpError(415, 'TXT · Word(docx) · MD 파일만 올릴 수 있습니다');
      const text = tidyText(body.text);
      if (text.replace(/\s/g, '').length < 5) throw new HttpError(400, '글이 거의 없는 파일입니다');
      const sha = shaOf(text);
      const make = !!body.make;
      const dup = await pool.query('SELECT rec_id FROM jcal.recording_minutes WHERE text_sha256 = $1 LIMIT 1', [sha]);
      if (dup.rows[0]) return { ok: true, duplicate: true, id: Number(dup.rows[0].rec_id) };
      const atN = Number(body.at), at = Number.isFinite(atN) && atN > 1e8 && atN < Date.now() / 1000 + 86400 ? new Date(atN * 1000) : null;
      // 이미 정리된 회의록 (Word 는 늘 회의록으로 봄, TXT · MD 는 kind 또는 1. 개요 ~ 6. 기타 같은 제목으로 판단): AI 없이 완료로 저장
      const asMin = body.kind === 'minutes' || (body.kind !== 'transcript' && (/\.docx$/i.test(name) || looksLikeMinutes(text)));
      if (asMin) {
        const mins = JSON.stringify(fileMinutes(text, { name, at }));
        const base0 = name.replace(/\.[^.]+$/, '').toLowerCase();
        const pr = await pool.query(`UPDATE jcal.recording_minutes SET minutes = $2, text_sha256 = $3, status = 'done', ai_model = $4, error = '', processed_at = now(), updated_at = now()
          WHERE rec_id = (SELECT rec_id FROM jcal.recording_minutes WHERE rec_id > 0 AND status IN ('idle', 'queued', 'failed', 'skipped') AND filename !~* '\\.(txt|md|docx)$'
            AND lower(regexp_replace(filename, '\\.[^.]+$', '')) = $1 ORDER BY rec_id DESC LIMIT 1) RETURNING rec_id`, [base0, mins, sha, FILE_AI]);
        if (pr.rows[0]) return { ok: true, paired: true, minutes: true, id: Number(pr.rows[0].rec_id) };
        const { rows } = await pool.query(`INSERT INTO jcal.recording_minutes (rec_id, device, filename, size_bytes, recorded_at, uploaded_at, status, auto_run, minutes, text_sha256, stt_model, ai_model, processed_at)
          VALUES (-nextval('jcal.recording_text_seq'), 'file', $1, $2, $3, now(), 'done', false, $4, $5, '', $6, now()) RETURNING rec_id`, [name, Buffer.byteLength(text), at, mins, sha, FILE_AI]);
        return { ok: true, minutes: true, id: Number(rows[0].rec_id) };
      }
      // 같은 이름의 녹음이 아직 회의록 전이면 그 녹음에 글을 붙인다 (받아쓰기 비용 아낌)
      const base = name.replace(/\.[^.]+$/, '').toLowerCase();
      const pair = await pool.query(`UPDATE jcal.recording_minutes SET transcript = $2, has_text = true, text_sha256 = $3, stt_model = 'TXT', error = '',
          status = CASE WHEN $4 THEN 'queued' ELSE status END, auto_run = CASE WHEN $4 THEN false ELSE auto_run END, updated_at = now()
        WHERE rec_id = (SELECT rec_id FROM jcal.recording_minutes WHERE rec_id > 0 AND NOT has_text AND status IN ('idle', 'queued', 'failed', 'skipped')
          AND lower(regexp_replace(filename, '\\.[^.]+$', '')) = $1 ORDER BY rec_id DESC LIMIT 1) RETURNING rec_id`, [base, text, sha, make]);
      if (pair.rows[0]) { if (make) drain(); return { ok: true, paired: true, id: Number(pair.rows[0].rec_id) }; }
      const { rows } = await pool.query(`INSERT INTO jcal.recording_minutes (rec_id, device, filename, size_bytes, recorded_at, uploaded_at, status, auto_run, transcript, has_text, text_sha256, stt_model)
        VALUES (-nextval('jcal.recording_text_seq'), 'txt', $1, $2, $3, now(), $4, false, $5, true, $6, 'TXT') RETURNING rec_id`,
      [name, Buffer.byteLength(text), at, make ? 'queued' : 'idle', text, sha]);
      if (make) drain();
      return { ok: true, id: Number(rows[0].rec_id) };
    },
  };
  const raw = {
    /** 예전 녹음 올리기: 조각(최대 4MB)을 차례로 받아 임시 파일에 모으고, 마지막 조각이 오면 녹음 서버로 넘긴다 */
    'POST /api/minutes/upload': async req => {
      await adminUser(req);
      const q = new URL(req.url, 'http://x').searchParams;
      const u = String(q.get('u') || ''), i = Number(q.get('i')), n = Number(q.get('n'));
      const name = path.basename(String(q.get('name') || '')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200);
      if (!/^[a-z0-9]{12,40}$/.test(u) || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > 60 || i < 0 || i >= n) throw new HttpError(400, '올리기 정보가 올바르지 않습니다');
      if (!UPLOAD_EXT.test(name)) throw new HttpError(415, '녹음 파일만 올릴 수 있습니다 (m4a · mp3 · amr · wav · 3gp · ogg · aac)');
      const file = path.join(os.tmpdir(), `jcal-up-${u}`);
      const st = ups.get(u) || { next: 0, size: 0, at: Date.now() };
      if (i < st.next) { for await (const c of req) void c; return { ok: true, part: i, again: true }; }   // 다시 보낸 조각 (이미 받음)
      if (i !== st.next) throw new HttpError(409, `조각 순서가 맞지 않습니다 (${st.next}번째부터 다시)`);
      let size = 0; const chunks = [];
      for await (const c of req) { size += c.length; if (size > CHUNK_MAX) throw new HttpError(413, '조각이 너무 큽니다'); chunks.push(c); }
      if (st.size + size > 200 * 1024 * 1024) { ups.delete(u); await fsp.rm(file, { force: true }); throw new HttpError(413, '200MB 가 넘는 녹음은 올릴 수 없습니다'); }
      await fsp.appendFile(file, Buffer.concat(chunks));
      ups.set(u, { next: i + 1, size: st.size + size, at: Date.now() });
      if (i < n - 1) return { ok: true, part: i };
      ups.delete(u);
      try {
        const at = /^\d{9,11}$/.test(String(q.get('at') || '')) ? `&recorded_at=${q.get('at')}` : '';
        let r;
        try {
          r = await fetch(`${recUrl()}/api/recordings/raw?device=web&filename=${encodeURIComponent(name)}${at}`, {
            method: 'POST', duplex: 'half', body: Readable.toWeb(fs.createReadStream(file)), signal: AbortSignal.timeout(10 * 60 * 1000),
            headers: { Authorization: `Bearer ${env.RECORDING_API_TOKEN || ''}`, 'Content-Type': 'application/octet-stream' },
          });
        } catch { throw new HttpError(502, '녹음 서버에 연결하지 못했습니다 (설정 창에서 상태 확인)'); }
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) throw new HttpError(502, '녹음 서버 토큰이 맞지 않습니다 (설정 창에서 확인)');
        if (!r.ok || !j.recording) throw new HttpError(r.status === 415 ? 415 : 502, j.error ? `녹음 서버: ${j.error}` : `녹음 서버 오류 (${r.status})`);
        const it = j.recording, rec = it.recorded_at ? new Date(it.recorded_at) : null;
        // 올린 녹음은 자동 정리하지 않음(수동). make=1 이면 바로 대기열 (버튼과 같은 대우)
        const make = q.get('make') === '1';
        await pool.query(`INSERT INTO jcal.recording_minutes (rec_id, sha256, device, filename, size_bytes, recorded_at, uploaded_at, status, auto_run)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false) ON CONFLICT (rec_id) DO NOTHING`,
        [it.id, String(it.sha256 || ''), String(it.device || 'web').slice(0, 60), String(it.filename || name), Number(it.size) || 0, rec && !Number.isNaN(rec.getTime()) ? rec : null, sqliteTime(it.uploaded_at) || new Date(), make ? 'queued' : 'idle']);
        if (make) { await pool.query(`UPDATE jcal.recording_minutes SET status = 'queued', auto_run = false, error = '' WHERE rec_id = $1 AND status IN ('idle', 'failed', 'skipped')`, [it.id]); drain(); }
        return { ok: true, done: true, duplicate: !!j.duplicate, id: it.id };
      } finally { await fsp.rm(file, { force: true }).catch(() => {}); }
    },
    'GET /api/minutes/audio': async (req, res) => {
      await adminUser(req);
      const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
      if (!Number.isInteger(id) || id === 0) throw new HttpError(400, '녹음 번호가 없습니다');
      if (id < 0) throw new HttpError(404, 'TXT 로 올린 글이라 녹음 파일이 없습니다');
      const r = await recFetch(`/api/recordings/${id}/file`, { timeout: 120000 }).catch(e => { throw new HttpError(502, e.message); });
      if (r.status === 404) throw new HttpError(404, '녹음 파일이 없습니다');
      if (!r.ok || !r.body) throw new HttpError(502, `녹음 파일을 받지 못했습니다 (${r.status})`);
      const head = { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
      if (r.headers.get('content-length')) head['Content-Length'] = r.headers.get('content-length');
      res.writeHead(200, head);
      await pipeline(Readable.fromWeb(r.body), res).catch(() => res.destroy());
      return RAW;
    },
  };
  async function start() {
    await pool.query("UPDATE jcal.recording_minutes SET status = 'queued', updated_at = now() WHERE status IN ('stt', 'summary')").catch(() => {});   // 처리 중에 서버가 꺼졌던 것은 다시
    setTimeout(() => tick().catch(() => {}), 15000).unref();
    timer = setInterval(() => tick().catch(() => {}), POLL_MS());
    timer.unref();
  }
  return { routes, raw, start };
}
