/* 녹음 · 회의록 — 휴대폰 녹음을 받는 서버(recording-api, 서비스 jcal-rec)에 올라온 녹음을 받아 적고(STT) AI 로 회의록을 만든다
   (db/migrations/013_recordings.sql · 관리자 계정만)
   GET  /api/minutes                 → { ready, auto, today, limit, items: [{ id, filename, device, at, status, title, kind, summary, … }] }
   GET  /api/minutes/item?id=        → { item: { …, transcript, minutes } }
   POST /api/minutes/process {id}    지금 만들기 · 다시 만들기 (대기열 맨 앞)
   POST /api/minutes/delete  {id}    녹음 파일 · 회의록 지우기 (recording-api 에서도 지움)
   GET  /api/minutes/audio?id=       녹음 파일 (재생용, recording-api 에서 받아 그대로 넘김)
   흐름: 1분마다 recording-api 목록 확인 → 새 녹음은 "대기" → 한 번에 1건씩
         ffmpeg 로 16kHz 모노 mp3 · 10분 단위로 나눔 → OpenAI 받아쓰기 → AI(Claude 우선) 회의록 JSON → 저장
   설정 (환경 변수, /etc/jcalender.env)
     RECORDING_API_URL (기본 http://127.0.0.1:8790) · RECORDING_API_TOKEN (setup.sh 가 만듦)
     MINUTES_AUTO=0 이면 자동 처리 안 함 (버튼으로만) · MINUTES_DAILY 하루 자동 처리 한도 (기본 30)
     MINUTES_BACKFILL_HOURS 처음 발견했을 때 이 시간 안에 올라온 녹음만 자동 처리 (기본 48, 나머지는 버튼)
     MINUTES_MAX_MIN 이보다 긴 녹음은 자동 처리 안 함 (기본 180분)
     MINUTES_STT_MODEL (기본 STT_MODEL 또는 gpt-4o-mini-transcribe, 키 OPENAI_API_KEY)
     MINUTES_PROVIDER anthropic | openai (기본: Anthropic 키가 있으면 Claude) · MINUTES_MODEL (기본 claude-opus-5-5 / gpt-5-mini)
   녹음 파일은 recording-api 에만 보관하고, 처리할 때 임시 폴더에 받아 쓴 뒤 바로 지운다 */
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import { askJson, AiError } from './shorts.mjs';
import { hasFfmpeg, RAW } from './shortsAssets.mjs';

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
export const STATUS = { idle: '수동', queued: '대기', stt: '받아쓰는 중', summary: '정리 중', done: '완료', failed: '실패', skipped: '건너뜀' };

class StepError extends Error { constructor(msg, status = 'failed') { super(msg); this.state = status; } }

/* ── recording-api 부르기 ── */
async function recFetch(p, { method = 'GET', timeout = 20000 } = {}) {
  if (!recReady()) throw new StepError('녹음 서버 토큰(RECORDING_API_TOKEN)이 없습니다. VPS 에서 update.sh 를 다시 실행하세요');
  let r;
  try { r = await fetch(recUrl() + p, { method, headers: { Authorization: `Bearer ${env.RECORDING_API_TOKEN}` }, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new StepError(e.name === 'TimeoutError' ? '녹음 서버가 응답하지 않습니다' : '녹음 서버(jcal-rec)에 연결하지 못했습니다'); }
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

async function summarize(row, transcript) {
  const at = row.recorded_at || row.uploaded_at || new Date();
  const prompt = `[녹음 정보]
- 녹음 일시: ${kst(new Date(at))} (날짜 기준: ${kstDate(new Date(at))})
- 파일 이름: ${row.filename || '없음'}
- 기기: ${row.device || '없음'}${row.duration ? `\n- 길이: 약 ${Math.max(1, Math.round(Number(row.duration) / 60))}분` : ''}

[받아쓴 글]
${transcript}`;
  try { return tidyMinutes(await askJson(prompt, { system: SYSTEM, schema: SCHEMA, name: 'meeting_minutes', provider: provider(), model: model() })); }
  catch (e) { if (e instanceof AiError) throw new StepError(e.message); console.error('[회의록 AI]', e); throw new StepError('AI 회의록을 받지 못했습니다'); }
}

/* ── 목록 · 대기열 ── */
const listOut = r => ({
  id: Number(r.rec_id), filename: r.filename, device: r.device, size: Number(r.size_bytes), at: r.recorded_at || r.uploaded_at, uploadedAt: r.uploaded_at,
  status: r.status, error: r.error || '', duration: r.duration == null ? null : Number(r.duration),
  title: r.minutes?.title || '', kind: r.minutes?.kind || '', summary: r.minutes?.summary || '', steps: r.minutes?.next_steps?.length || 0,
  sttModel: r.stt_model || '', aiModel: r.ai_model || '', processedAt: r.processed_at,
});

export function minutesModule({ pool, adminUser, HttpError }) {
  let busy = false, lastSync = 0, timer = null, syncing = null;

  const doSync = async () => {
    try {
      if (!recReady()) return;
      const j = await recJson('/api/recordings?limit=200');
      const fresh = Date.now() - BACKFILL_H() * 3600e3;
      for (const it of j.items || []) {
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
    } catch (e) { if (!(e instanceof StepError)) console.error('[회의록 목록]', e); else console.warn('[회의록 목록]', e.message); lastSync = Date.now(); }
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
    'GET /api/minutes': async req => {
      await adminUser(req);
      if (Date.now() - lastSync > 15000) { syncList().then(drain).catch(() => {}); }   // 화면이 볼 때마다 새 녹음 확인 (기다리지 않음)
      const { rows } = await pool.query('SELECT rec_id, filename, device, size_bytes, recorded_at, uploaded_at, status, error, duration, minutes, stt_model, ai_model, processed_at FROM jcal.recording_minutes ORDER BY coalesce(recorded_at, uploaded_at) DESC NULLS LAST, rec_id DESC LIMIT 300');
      return {
        ready: { api: recReady(), stt: sttReady(), ai: aiReady(), ffmpeg: hasFfmpeg }, auto: AUTO(), today: await doneToday(), limit: DAILY(),
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
    'POST /api/minutes/process': async (req, body) => {
      await adminUser(req);
      const id = Number(body.id);
      const { rowCount } = await pool.query(`UPDATE jcal.recording_minutes SET status = 'queued', auto_run = false, error = '', updated_at = now() WHERE rec_id = $1 AND status NOT IN ('stt', 'summary')`, [id]);
      if (!rowCount) throw new HttpError(409, '이미 처리 중이거나 없는 녹음입니다');
      drain();
      return { ok: true };
    },
    'POST /api/minutes/delete': async (req, body) => {
      await adminUser(req);
      const id = Number(body.id);
      const { rows } = await pool.query('SELECT status FROM jcal.recording_minutes WHERE rec_id = $1', [id]);
      if (!rows[0]) throw new HttpError(404, '없는 녹음입니다');
      if (BUSY.includes(rows[0].status)) throw new HttpError(409, '처리 중에는 지울 수 없습니다. 끝난 뒤 다시 시도하세요');
      const r = await recFetch(`/api/recordings/${id}`, { method: 'DELETE' }).catch(e => { throw new HttpError(502, e.message); });
      if (!r.ok && r.status !== 404) throw new HttpError(502, `녹음 서버에서 지우지 못했습니다 (${r.status})`);
      await pool.query('DELETE FROM jcal.recording_minutes WHERE rec_id = $1', [id]);
      return { ok: true };
    },
  };
  const raw = {
    'GET /api/minutes/audio': async (req, res) => {
      await adminUser(req);
      const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
      if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '녹음 번호가 없습니다');
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
