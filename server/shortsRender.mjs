/* 숏폼 제작 3차 — 영상 만들기 (db/migrations/007_shorts_renders.sql)
   POST /api/shorts/render         {scriptId}            제작 준비(배경 · 음악) + 영상 설정으로 영상 만들기 → 대기열
   POST /api/shorts/render/remove  {id}                  영상 지우기 (만드는 중이면 멈춤)
   GET  /api/shorts/renders                              영상 목록 (진행률 확인용, 가벼움)
   POST /api/shorts/voice          {voice, text?}        목소리 들어 보기 (짧은 예문)
   순서: ① 문장마다 OpenAI 음성(TTS) → 앞뒤 빈 소리를 다듬어 이어 붙임 (문장 시작 · 끝 시간을 정확히 앎)
         ② 자막(ASS): 문장 → 자막 화면 → 낱말마다 강조색 (말하는 시간에 비례)
         ③ 배경: 하나씩 1080×1920 조각으로 (짧은 영상은 반복 · 사진은 천천히 확대) ④ 조각 + 자막 + 나레이션 + 배경음악(나레이션 중 자동으로 작게) → mp4
   - 한 번에 1개씩 만든다 (VPS 가 느려지지 않게 낮은 우선순위). 서버가 다시 시작되면 만들던 영상은 처음부터 다시
   - 음성: 환경 변수 OPENAI_API_KEY (AI 공급자가 Claude 여도 음성은 OpenAI), 모델 TTS_MODEL (기본 gpt-4o-mini-tts) */
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { settingsOf } from './shorts.mjs';
import { ROOT, QUOTA, hasFfmpeg, renderPath, assetFile, fileUrl, usage, probe } from './shortsAssets.mjs';
import { clampVideo, splitSentences, screensOf, speakWeight, VOICES } from './shortsText.mjs';

const env = process.env;
const W = 1080, H = 1920, FPS = 30, TAIL = 0.8;              // 나레이션이 끝난 뒤 여유 (초)
export const ttsModel = () => env.TTS_MODEL || 'gpt-4o-mini-tts';
export const ttsReady = () => !!env.OPENAI_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── ① 음성 ── */
class RenderError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
async function tts(text, voice, signal) {
  const body = { model: ttsModel(), voice, input: text, response_format: 'wav' };
  if (/gpt-4o/.test(body.model)) body.instructions = '한국어 숏폼 나레이션. 또렷하고 생동감 있게, 너무 느리지 않게 읽기. 문장 끝은 자연스럽게.';
  let r;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await fetch(`${(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/audio/speech`, {
        method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(body),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (attempt >= 2) throw new RenderError('OpenAI 음성 서버에 연결하지 못했습니다', 502);
      await sleep(2000 * (attempt + 1)); continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 2) { await r.arrayBuffer().catch(() => {}); await sleep(3000 * (attempt + 1)); continue; }
    break;
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({})), code = j.error?.code || j.error?.type || '';
    console.error('[숏폼 음성 · OpenAI]', r.status, code, j.error?.message);
    if (r.status === 401) throw new RenderError('OpenAI API 키가 올바르지 않습니다 (jcal-admin ai-key 로 다시 넣기)', 503);
    if (code === 'insufficient_quota') throw new RenderError('OpenAI 크레딧(잔액)이 없습니다. platform.openai.com › Billing 에서 충전하세요', 402);
    if (r.status === 429) throw new RenderError('OpenAI 사용량 한도에 걸렸습니다. 잠시 뒤 다시 만들어 주세요', 429);
    if (r.status === 404 || code === 'model_not_found') throw new RenderError(`음성 모델을 쓸 수 없습니다: ${ttsModel()} (TTS_MODEL 확인)`, 503);
    throw new RenderError(`음성 만들기 실패 (${r.status})`, 502);
  }
  return Buffer.from(await r.arrayBuffer());
}
/** WAV(16비트 PCM) 읽기 — 스트리밍 응답은 data 크기가 비어 있을 수 있어 남은 길이를 씀 */
export function readWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new RenderError('음성 파일 형식을 읽지 못했습니다', 502);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4), start = o + 8;
    let size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(start), ch: buf.readUInt16LE(start + 2), rate: buf.readUInt32LE(start + 4), bits: buf.readUInt16LE(start + 14) };
    else if (id === 'data') { if (!size || start + size > buf.length) size = buf.length - start; data = buf.subarray(start, start + size); break; }
    o = start + size + (size & 1);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.bits !== 16) throw new RenderError('음성 파일 형식(16비트 WAV)이 아닙니다', 502);
  const frame = 2 * fmt.ch;
  return { rate: fmt.rate, ch: fmt.ch, frame, pcm: data.subarray(0, data.length - (data.length % frame)) };
}
export function wavFile(pcm, rate, ch) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
/** 말소리가 있는 구간 (앞뒤 빈 소리 빼고) → [시작 프레임, 끝 프레임) */
function voiced(w) {
  const n = w.pcm.length / w.frame, thr = 700;               // 약 -33dBFS
  let a = 0, b = n;
  while (a < n && Math.abs(w.pcm.readInt16LE(a * w.frame)) < thr) a++;
  while (b > a && Math.abs(w.pcm.readInt16LE((b - 1) * w.frame)) < thr) b--;
  return a >= b ? [0, n] : [a, b];
}
/** 문장 음성들을 다듬어 이어 붙임 → { wav, rate, spans: [{ a, b }] (말하는 구간, 초) , total } */
export function joinVoices(wavs, { lead = 0.06, tail = 0.18, gap = 0.12 } = {}) {
  const first = wavs[0];
  const parts = [], spans = [];
  let t = 0;
  for (const w of wavs) {
    if (w.rate !== first.rate || w.ch !== first.ch) throw new RenderError('음성 파일 형식이 서로 다릅니다', 502);
    const [a, b] = voiced(w), n = w.pcm.length / w.frame;
    const s = Math.max(0, a - Math.round(lead * w.rate)), e = Math.min(n, b + Math.round(tail * w.rate));
    parts.push(w.pcm.subarray(s * w.frame, e * w.frame));
    spans.push({ a: t + (a - s) / w.rate, b: t + (b - s) / w.rate });
    t += (e - s) / w.rate;
    const g = Math.round(gap * w.rate) * w.frame;
    parts.push(Buffer.alloc(g)); t += g / w.frame / w.rate;
  }
  return { wav: wavFile(Buffer.concat(parts), first.rate, first.ch), rate: first.rate, spans, total: t };
}

/* ── ② 자막 (ASS) ── */
const FONT_NAME = { 'Noto Sans KR': 'Noto Sans CJK KR' };      // 서버에는 apt 의 fonts-noto-cjk (굵기 여러 개)
const BOLD = new Set(['Noto Sans KR', 'Nanum Gothic', 'Nanum Myeongjo']);   // 굵게 쓸 글꼴 (한 굵기뿐인 글꼴은 그대로)
const assColor = (hex, alpha = 0) => `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
const assEsc = s => String(s).replace(/\\/g, '＼').replace(/\{/g, '｛').replace(/\}/g, '｝').replace(/\n/g, ' ');
const ts = x => { const c = Math.max(0, Math.round(x * 100)); const h = Math.floor(c / 360000), m = Math.floor(c / 6000) % 60, s = Math.floor(c / 100) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`; };
/** sentences: 문장 글 · spans: 말하는 구간(나레이션 빠르기 반영 전) · end: 영상 길이 → ASS 글 */
export function buildAss({ sentences, spans, speed = 1, end, title = '', V }) {
  const S = V.sub, font = FONT_NAME[S.font] || S.font, bold = BOLD.has(S.font) ? -1 : 0;
  const align = { top: 8, middle: 5, bottom: 2 }[S.position];
  const marginV = S.position === 'top' ? (V.showTitle && title ? 470 : 260) : S.position === 'bottom' ? 420 : 0;
  const style = (name, { size, primary, outline, back, borderStyle, outlineW, al, mv, b = bold, f = font }) =>
    `Style: ${name},${f},${size},${primary},${primary},${outline},${back},${b},0,0,0,100,100,0,0,${borderStyle},${outlineW},0,${al},70,70,${mv},1`;
  const boxA = Math.round(255 * (1 - S.boxOpacity / 100));
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Sub', { size: S.size, primary: assColor(S.color), outline: assColor(S.stroke), back: assColor('#000000', 255), borderStyle: 1, outlineW: S.strokeWidth / 2, al: align, mv: marginV }),
    style('SubBox', { size: S.size, primary: assColor(S.color, 255), outline: assColor(S.boxColor, boxA), back: assColor(S.boxColor, boxA), borderStyle: 3, outlineW: 14, al: align, mv: marginV }),
    style('Title', { size: 66, primary: assColor('#FFFFFF'), outline: assColor('#000000', 90), back: assColor('#000000', 90), borderStyle: 3, outlineW: 18, al: 8, mv: 200, b: bold }),
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = (layer, a, b, st, text) => lines.push(`Dialogue: ${layer},${ts(a)},${ts(b)},${st},,0,0,0,,${text}`);
  if (V.showTitle && title) ev(0, 0, end, 'Title', assEsc(title));
  const hl = assColor(S.highlight).slice(4);                  // \c 는 &HBBGGRR&
  sentences.forEach((sen, i) => {
    const a = spans[i].a / speed, b = spans[i].b / speed;
    const until = i + 1 < sentences.length ? spans[i + 1].a / speed : end;   // 다음 문장이 시작할 때까지 남겨 둠 (깜빡임 없게)
    const screens = screensOf(sen, S.lineChars, S.maxLines);
    const words = screens.map(sc => sc.map(l => l.split(' ')));
    const weights = words.map(sc => sc.flat().map(speakWeight));
    const total = weights.flat().reduce((x, y) => x + y, 0) || 1;
    let t = a;
    screens.forEach((sc, k) => {
      const ws = words[k], wt = weights[k];
      const scStart = t, scDur = (b - a) * (wt.reduce((x, y) => x + y, 0) / total);
      const scEnd = k + 1 < screens.length ? scStart + scDur : until;
      if (S.box) ev(1, scStart, scEnd, 'SubBox', ws.map(l => assEsc(l.join(' '))).join('\\N'));
      let wtime = scStart;
      const flat = ws.flat();
      flat.forEach((_, j) => {
        const wStart = wtime, wEnd = j + 1 < flat.length ? wtime + scDur * (wt[j] / (wt.reduce((x, y) => x + y, 0) || 1)) : scEnd;
        let n = 0;
        const text = ws.map(l => l.map(w => (n++ === j ? `{\\c&H${hl}&}${assEsc(w)}{\\r}` : assEsc(w))).join(' ')).join('\\N');
        if (wEnd > wStart + 0.005) ev(2, wStart, wEnd, 'Sub', text);
        wtime = wEnd;
      });
      t = scStart + scDur;
    });
  });
  return `${lines.join('\n')}\n`;
}

/* ── ③ ④ ffmpeg ── */
function ffmpeg(args, { cwd, signal, onTime, timeout = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { cwd });
    try { os.setPriority(p.pid, 10); } catch { /* 우선순위를 못 바꿔도 계속 */ }
    let err = '', out = '';
    p.stderr.on('data', c => { err = (err + c).slice(-3000); });
    p.stdout.on('data', c => { out = (out + c).slice(-400); const m = [...out.matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop(); if (m && onTime) onTime(Number(m[1]) / 1e6); });
    const kill = () => p.kill('SIGKILL');
    const timer = setTimeout(kill, timeout);
    signal?.addEventListener('abort', kill, { once: true });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', kill);
      if (signal?.aborted) reject(new RenderError('취소했습니다'));
      else if (code === 0) resolve();
      else { console.error('[숏폼 영상 · ffmpeg]', err); reject(new RenderError(`영상 도구(ffmpeg) 오류: ${err.trim().split('\n').slice(-1)[0]?.slice(0, 200) || code}`, 500)); }
    });
  });
}
const COVER = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
const BLUR = `split[a][b];[a]${COVER},boxblur=24:2[bg];[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
/** 배경 조각 하나 (영상: 반복 · 이어서 / 사진: 천천히 확대 · 축소) */
function segmentArgs(a, file, dur, offset, fit, n, out) {
  const enc = ['-an', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-t', dur.toFixed(3), out];
  const base = fit === 'blur' ? BLUR : COVER;
  if (a.kind === 'image') {
    const frames = Math.max(1, Math.round(dur * FPS)), z = n % 2 ? `1.1-0.1*on/${frames}` : `1+0.1*on/${frames}`;
    return ['-y', '-v', 'error', '-loop', '1', '-framerate', String(FPS), '-i', file,
      '-vf', `${base},scale=${W * 1.5}:${H * 1.5},zoompan=z='${z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p`, ...enc];
  }
  return ['-y', '-v', 'error', '-stream_loop', '-1', '-ss', offset.toFixed(3), '-i', file, '-vf', `${base},setsar=1,fps=${FPS},format=yuv420p`, ...enc];
}

/** 영상 하나 만들기 → { duration, size } */
async function build(job, work, step, signal) {
  const I = job.input, V = clampVideo(I.video);
  const sentences = splitSentences(I.script).map(s => s.slice(0, 4000));
  if (!sentences.length) throw new RenderError('스크립트가 비어 있습니다');
  // ① 문장마다 음성 (동시에 3개씩)
  await step('목소리 만드는 중', 3);
  const wavs = new Array(sentences.length);
  let doneN = 0, next = 0;
  await Promise.all(Array.from({ length: Math.min(3, sentences.length) }, async () => {
    while (next < sentences.length) {
      const i = next++;
      wavs[i] = readWav(await tts(sentences[i], V.voice, signal));
      doneN++; await step('목소리 만드는 중', 3 + Math.round(27 * doneN / sentences.length));
    }
  }));
  const voice = joinVoices(wavs);
  await fsp.writeFile(path.join(work, 'voice.wav'), voice.wav);
  const T = voice.total / V.speed + TAIL;
  // ② 자막
  await fsp.writeFile(path.join(work, 'subs.ass'), buildAss({ sentences, spans: voice.spans, speed: V.speed, end: T, title: I.title, V }));
  // ③ 배경 조각
  const bgs = [];
  for (const a of I.backgrounds) if (fs.existsSync(assetFile(a))) bgs.push(a);
  if (!bgs.length) throw new RenderError('배경 소재가 모두 지워졌습니다. 제작 준비에서 배경을 다시 골라 주세요');
  const n = Math.min(300, Math.ceil(T / V.clipSeconds - 1e-6));
  const used = {}, list = [];
  for (let i = 0; i < n; i++) {
    const a = bgs[i % bgs.length], dur = Math.min(V.clipSeconds, T - i * V.clipSeconds);
    if (dur <= 0.05) break;
    const k = used[a.id] = (used[a.id] ?? -1) + 1;           // 같은 영상을 또 쓰면 이어지는 부분부터
    const len = Number(a.duration) || 0;
    const offset = a.kind === 'video' && len > V.clipSeconds + 0.5 ? (k * V.clipSeconds) % (len - 0.3) : 0;
    const out = `seg${String(i).padStart(3, '0')}.mp4`;
    await ffmpeg(segmentArgs(a, assetFile(a), dur, offset, V.fit, i, out), { cwd: work, signal });
    list.push(`file '${out}'`);
    await step('배경 만드는 중', 30 + Math.round(40 * (i + 1) / n));
  }
  await fsp.writeFile(path.join(work, 'list.txt'), `${list.join('\n')}\n`);
  // ④ 합치기: 배경 + 자막 + 나레이션 + 배경음악 (나레이션 중 자동으로 작게)
  const music = I.music && V.musicVolume > 0 && fs.existsSync(assetFile(I.music)) ? assetFile(I.music) : null;
  const AF = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
  const voiceChain = `[1:a]atempo=${V.speed},${AF},apad=pad_dur=${TAIL}`;
  const fc = [`[0:v]subtitles=subs.ass[v]`, music
    ? `${voiceChain},asplit=2[va][vs];[2:a]${AF},volume=${(V.musicVolume / 100).toFixed(2)}[m];[m][vs]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=500[duck];[va][duck]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=${Math.max(0, T - 1).toFixed(2)}:d=1[a]`
    : `${voiceChain}[a]`].join(';');
  const out = renderPath(job.user_id, job.id);
  await step('합치는 중', 71);
  await ffmpeg(['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'voice.wav', ...(music ? ['-stream_loop', '-1', '-i', music] : []),
    '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-t', T.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', out], { cwd: work, signal, onTime: s => step('합치는 중', 71 + Math.min(26, Math.round(26 * s / T))) });
  await ffmpeg(['-y', '-v', 'error', '-ss', String(Math.min(1, T / 2)), '-i', out, '-frames:v', '1', '-vf', 'scale=-2:640', '-q:v', '4', renderPath(job.user_id, job.id, 'rthumb')], { signal }).catch(() => {});
  const meta = await probe(out);
  return { duration: meta.duration ?? T, size: (await fsp.stat(out)).size };
}

/* ── 대기열 (한 번에 1개) ── */
let current = null, kicking = false;
async function runJob(pool, job) {
  const ctrl = new AbortController();
  current = { id: job.id, ctrl };
  const work = renderPath(job.user_id, job.id, 'work');
  let last = { stage: '', p: -1, at: 0 };
  const step = async (stage, p) => {                          // 진행률은 1초에 한 번쯤만 기록
    if (stage === last.stage && p - last.p < 2 && Date.now() - last.at < 1000) return;
    last = { stage, p, at: Date.now() };
    await pool.query("UPDATE jcal.shorts_renders SET stage = $2, progress = $3 WHERE id = $1 AND status = 'running'", [job.id, stage, Math.min(99, p)]);
  };
  try {
    await fsp.mkdir(work, { recursive: true });
    const r = await build(job, work, step, ctrl.signal);
    const u = await pool.query("UPDATE jcal.shorts_renders SET status = 'done', stage = '완성', progress = 100, duration = $2, size_bytes = $3, finished_at = now() WHERE id = $1 RETURNING id", [job.id, r.duration, r.size]);
    if (!u.rowCount) await removeFiles(job);                 // 만드는 사이에 지움
  } catch (e) {
    await removeFiles(job, false);
    if (!(e instanceof RenderError)) console.error('[숏폼 영상]', e);
    await pool.query("UPDATE jcal.shorts_renders SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [job.id, e instanceof RenderError ? e.message : '영상을 만들지 못했습니다 (서버 기록: journalctl -u jcal-api)']).catch(() => {});
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    current = null;
  }
}
async function removeFiles(job, all = true) {
  await Promise.all([fsp.rm(renderPath(job.user_id, job.id), { force: true }), fsp.rm(renderPath(job.user_id, job.id, 'rthumb'), { force: true }),
    all && fsp.rm(renderPath(job.user_id, job.id, 'work'), { recursive: true, force: true })].filter(Boolean)).catch(() => {});
}
export function kickRenders(pool) {
  if (kicking) return;
  kicking = true;
  (async () => {
    try {
      for (;;) {
        const { rows } = await pool.query(`UPDATE jcal.shorts_renders SET status = 'running', started_at = now(), stage = '시작', progress = 1, error = ''
          WHERE id = (SELECT id FROM jcal.shorts_renders WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
        if (!rows[0]) break;
        await runJob(pool, rows[0]);
      }
    } catch (e) { console.error('[숏폼 영상 대기열]', e); } finally { kicking = false; }
  })();
}
export async function startRenderWorker(pool) {
  await pool.query("UPDATE jcal.shorts_renders SET status = 'queued', stage = '서버가 다시 시작되어 처음부터', progress = 0 WHERE status = 'running'").catch(() => {});
  kickRenders(pool);
  setInterval(() => kickRenders(pool), 60 * 1000).unref();
}

const renderOut = r => ({ ...r, duration: r.duration == null ? null : Number(r.duration), size_bytes: Number(r.size_bytes),
  ...(r.status === 'done' ? { url: fileUrl(r.id, 'render'), thumb: fileUrl(r.id, 'rthumb') } : {}) });
export async function rendersOf(pool, uid) {
  const { rows } = await pool.query(`SELECT id, script_id, title, status, stage, progress, error, duration, size_bytes, created_at, started_at, finished_at,
      CASE WHEN status = 'queued' THEN (SELECT count(*) FROM jcal.shorts_renders q WHERE q.status IN ('queued', 'running') AND q.created_at < r.created_at)::int END AS ahead
    FROM jcal.shorts_renders r WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60`, [uid]);
  return { renders: rows.map(renderOut), tts: { ready: ttsReady(), model: ttsModel() }, render: { ready: hasFfmpeg && ttsReady(), ffmpeg: hasFfmpeg } };
}

/* ── 경로 ── */
export function renderRoutes({ pool, adminUser, HttpError }) {
  const user = adminUser;
  const uuidOk = v => /^[0-9a-f-]{36}$/i.test(String(v || ''));
  const need = v => { if (!uuidOk(v)) throw new HttpError(400, 'id 가 올바르지 않습니다'); return v; };
  return {
    'GET /api/shorts/renders': async req => rendersOf(pool, (await user(req)).id),

    'POST /api/shorts/render': async (req, body) => {
      const u = await user(req);
      if (!hasFfmpeg) throw new HttpError(503, '서버에 영상 도구(ffmpeg)가 없습니다. VPS 에서 bash server/deploy/update.sh 를 다시 실행하세요');
      if (!ttsReady()) throw new HttpError(503, '나레이션 음성에 OpenAI API 키가 필요합니다. VPS 터미널에서 jcal-admin ai-key 로 넣어 주세요');
      const { rows: [s] } = await pool.query('SELECT * FROM jcal.shorts_scripts WHERE id = $1 AND user_id = $2', [need(body.scriptId), u.id]);
      if (!s) throw new HttpError(404, '없는 스크립트입니다');
      if (!splitSentences(s.script).length) throw new HttpError(400, '스크립트가 비어 있습니다');
      const { rows: [p] } = await pool.query('SELECT * FROM jcal.shorts_projects WHERE script_id = $1', [s.id]);
      const ids = p?.backgrounds || [];
      const { rows: assets } = await pool.query('SELECT id, user_id, kind, ext, duration FROM jcal.shorts_assets WHERE user_id = $1 AND id = ANY($2::uuid[])', [u.id, ids]);
      const byId = Object.fromEntries(assets.map(a => [a.id, { ...a, duration: a.duration == null ? null : Number(a.duration) }]));
      const backgrounds = ids.map(id => byId[id]).filter(a => a && a.kind !== 'music');
      if (!backgrounds.length) throw new HttpError(400, '배경이 없습니다. ④ 제작 준비에서 배경을 골라 주세요');
      const music = p?.music_id ? (await pool.query('SELECT id, user_id, kind, ext, duration FROM jcal.shorts_assets WHERE id = $1 AND user_id = $2', [p.music_id, u.id])).rows[0] || null : null;
      const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM jcal.shorts_renders WHERE user_id = $1 AND status IN ('queued', 'running')", [u.id]);
      if (n >= 5) throw new HttpError(429, '만드는 중인 영상이 5개입니다. 끝난 뒤에 더 넣어 주세요');
      const used = await usage(pool, u.id);
      if (used + 40 * 1048576 > QUOTA) throw new HttpError(413, `저장 공간이 모자랍니다 (${Math.round(used / 1048576)}MB / ${Math.round(QUOTA / 1048576)}MB). 안 쓰는 소재나 영상을 지워 주세요`);
      const video = (await settingsOf(pool, u.id)).video;
      const { rows: [r] } = await pool.query('INSERT INTO jcal.shorts_renders (user_id, script_id, title, input) VALUES ($1, $2, $3, $4) RETURNING *',
        [u.id, s.id, s.title, { title: s.title, script: s.script, hashtags: s.hashtags, backgrounds, music, video }]);
      await fsp.mkdir(path.join(ROOT, u.id, 'renders'), { recursive: true });
      kickRenders(pool);
      return { render: renderOut(r) };
    },

    'POST /api/shorts/render/remove': async (req, body) => {
      const u = await user(req);
      const { rows: [r] } = await pool.query('DELETE FROM jcal.shorts_renders WHERE id = $1 AND user_id = $2 RETURNING id, user_id', [need(body.id), u.id]);
      if (!r) throw new HttpError(404, '없는 영상입니다');
      if (current?.id === r.id) current.ctrl.abort();         // 만드는 중이면 멈춤 (파일은 runJob 이 정리)
      else await removeFiles(r);
      return { ok: true };
    },

    'POST /api/shorts/voice': async (req, body) => {
      await user(req);
      if (!ttsReady()) throw new HttpError(503, 'OpenAI API 키가 없습니다 (jcal-admin ai-key)');
      const voice = VOICES.some(([k]) => k === body.voice) ? body.voice : 'nova';
      const text = String(body.text || '').trim().slice(0, 200) || '안녕하세요. 이 목소리로 숏폼 나레이션을 읽어 드릴게요. 끝까지 보시면 반전이 있습니다.';
      const file = path.join(ROOT, '_voices', `${voice}-${crypto.createHash('sha1').update(`${ttsModel()}|${text}`).digest('hex').slice(0, 16)}.wav`);   // 같은 예문은 다시 돈 안 씀
      let buf = await fsp.readFile(file).catch(() => null);
      if (!buf) {
        try { buf = await tts(text, voice); readWav(buf); } catch (e) { throw new HttpError(e.status || 502, e.message); }
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, buf);
      }
      return { audio: `data:audio/wav;base64,${buf.toString('base64')}` };
    },
  };
}
