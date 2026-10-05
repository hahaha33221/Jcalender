/* 숏폼 제작 2차 — 소재함 · Pexels 무료 소재 · 제작 준비 (db/migrations/006_shorts_assets.sql)
   POST /api/shorts/upload        (본문 = 파일 그대로, 머리글 X-File-Name)  소재 올리기 (영상 · 이미지 · 음악)
   GET  /api/shorts/file?id&k&exp&sig                                     파일 · 미리보기 그림 (서명된 주소, 6시간)
   POST /api/shorts/asset         {id, name?, tags?, remove?}             소재 이름 · 태그 · 지우기
   POST /api/shorts/pexels        {query, type: video | image, page}      Pexels 검색 (세로 우선)
   POST /api/shorts/pexels/save   {id, type, query}                       고른 Pexels 소재를 소재함에 담기
   POST /api/shorts/keywords      {scriptId}                              스크립트 → 소재 검색어 · 분위기 (AI)
   POST /api/shorts/project       {scriptId, backgrounds?, musicId?, keywords?, mood?}   스크립트별 배경 · 음악
   - 파일은 VPS 디스크(systemd StateDirectory → /var/lib/jcalender/shorts/<사용자>/)에 저장, 사용자당 SHORTS_QUOTA_MB(기본 5000MB)
   - ffmpeg 가 있으면 길이 · 크기를 읽고 미리보기 그림을 만든다 (setup.sh 가 설치) */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { askJson } from './shorts.mjs';
import { MOODS } from './shortsText.mjs';

const env = process.env;
export const ROOT = env.SHORTS_DIR || (env.STATE_DIRECTORY ? path.join(env.STATE_DIRECTORY.split(':')[0], 'shorts') : path.resolve('data/shorts'));
const MAX_UPLOAD = Number(env.SHORTS_MAX_UPLOAD_MB || 300) * 1024 * 1024;
export const QUOTA = Number(env.SHORTS_QUOTA_MB || 5000) * 1024 * 1024;
export const SECRET = env.SHORTS_SECRET || crypto.createHash('sha256').update(`jcal-shorts|${env.DATABASE_URL || 'dev'}`).digest('hex');   // 서버만 아는 값
export const hasFfmpeg = (() => { try { return spawnSync('ffprobe', ['-version'], { timeout: 5000 }).status === 0; } catch { return false; } })();
export const pexelsReady = () => !!env.PEXELS_API_KEY;

const TYPES = {
  video: { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska' },
  image: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' },
  music: { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' },
};
const kindOf = (ext, mime) => {
  for (const [k, m] of Object.entries(TYPES)) if (m[ext]) return k;
  if (/^video\//.test(mime)) return 'video'; if (/^image\//.test(mime)) return 'image'; if (/^audio\//.test(mime)) return 'music';
  return null;
};
const mimeOf = (kind, ext) => TYPES[kind]?.[ext] || 'application/octet-stream';
const userDir = async uid => { const d = path.join(ROOT, uid); await fsp.mkdir(d, { recursive: true }); return d; };
const fileOf = (a, k = 'file') => path.join(ROOT, a.user_id, k === 'thumb' ? `${a.id}.thumb.jpg` : `${a.id}.${a.ext}`);
/** 3차: 완성 영상 (k = render · rthumb) — /var/lib/jcalender/shorts/<사용자>/renders/<id>.mp4 */
export const renderPath = (uid, id, k = 'render') => path.join(ROOT, uid, 'renders', k === 'rthumb' ? `${id}.jpg` : k === 'work' ? `${id}.work` : `${id}.mp4`);
export const assetFile = fileOf;

/** 서명된 주소 (video · img 태그가 로그인 머리글 없이 읽을 수 있게) */
const sign = (id, k, exp) => crypto.createHmac('sha256', SECRET).update(`${id}.${k}.${exp}`).digest('base64url');
export const fileUrl = (id, k = 'file') => { const exp = Math.floor(Date.now() / 1000) + 6 * 3600; return `/api/shorts/file?id=${id}&k=${k}&exp=${exp}&sig=${sign(id, k, exp)}`; };

/** ffprobe: 길이 · 가로 · 세로 */
export function probe(file) {
  if (!hasFfmpeg) return Promise.resolve({});
  return new Promise(resolve => {
    const p = spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
    let out = ''; p.stdout.on('data', c => { out += c; });
    const t = setTimeout(() => p.kill('SIGKILL'), 20000);
    p.on('close', () => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out), v = (j.streams || []).find(s => s.codec_type === 'video');
        let w = v?.width, h = v?.height;
        const rot = Math.abs(Number(v?.tags?.rotate || v?.side_data_list?.find(x => x.rotation !== undefined)?.rotation || 0));
        if (rot === 90 || rot === 270) [w, h] = [h, w];                 // 휴대폰 세로 영상
        const dur = Number(j.format?.duration);
        resolve({ width: w || null, height: h || null, duration: Number.isFinite(dur) && dur > 0 ? dur : null });
      } catch { resolve({}); }
    });
    p.on('error', () => { clearTimeout(t); resolve({}); });
  });
}
/** 미리보기 그림 (세로 360px) */
function thumb(src, dst, kind, duration) {
  if (!hasFfmpeg || kind === 'music') return Promise.resolve(false);
  const args = ['-y', '-v', 'error', ...(kind === 'video' ? ['-ss', String(Math.min(1, (duration || 0) / 2))] : []), '-i', src, '-frames:v', '1', '-vf', 'scale=-2:360', '-q:v', '5', dst];
  return new Promise(resolve => {
    const p = spawn('ffmpeg', args);
    const t = setTimeout(() => p.kill('SIGKILL'), 30000);
    p.on('close', code => { clearTimeout(t); resolve(code === 0 && fs.existsSync(dst)); });
    p.on('error', () => { clearTimeout(t); resolve(false); });
  });
}
export async function usage(pool, uid) {             // 소재 + 완성 영상
  const { rows } = await pool.query(`SELECT (SELECT COALESCE(SUM(size_bytes), 0) FROM jcal.shorts_assets WHERE user_id = $1)
    + (SELECT COALESCE(SUM(size_bytes), 0) FROM jcal.shorts_renders WHERE user_id = $1) AS b`, [uid]);
  return Number(rows[0].b);
}
/** 받은 파일을 소재로 등록 (크기 · 미리보기 계산) */
async function register(pool, { id, uid, kind, ext, name, size, source = 'upload', sourceUrl = '', credit = '', tags = '' }) {
  const a = { id, user_id: uid, ext };
  const meta = await probe(fileOf(a));
  if (kind === 'image') meta.duration = null;               // 사진은 길이 없음 (ffprobe 는 0.04초로 읽음)
  const hasThumb = await thumb(fileOf(a), fileOf(a, 'thumb'), kind, meta.duration);
  const { rows } = await pool.query(`INSERT INTO jcal.shorts_assets (id, user_id, kind, name, ext, mime, size_bytes, width, height, duration, tags, source, source_url, credit, has_thumb)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
  [id, uid, kind, String(name).slice(0, 200), ext, mimeOf(kind, ext), size, meta.width ?? null, meta.height ?? null, meta.duration ?? null, tags, source, sourceUrl, credit, hasThumb]);
  return rows[0];
}
export const assetOut = a => ({ ...a, duration: a.duration == null ? null : Number(a.duration), size_bytes: Number(a.size_bytes), url: fileUrl(a.id), thumb: a.has_thumb ? fileUrl(a.id, 'thumb') : null });

/** 스트림을 파일로 (크기 제한) */
async function streamTo(body, file, limit) {
  let n = 0;
  const out = fs.createWriteStream(file, { mode: 0o640 });
  try {
    for await (const chunk of body) {
      n += chunk.length;
      if (n > limit) throw Object.assign(new Error(`파일이 너무 큽니다 (${Math.round(limit / 1024 / 1024)}MB 까지)`), { status: 413 });
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
    }
    await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
    return n;
  } catch (e) { out.destroy(); await fsp.rm(file, { force: true }); throw e; }
}
/** Pexels 파일 내려받기: pexels.com · vimeo.com 주소만 (리디렉션도 확인) */
async function download(url, file, limit) {
  let u = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    if (env.SHORTS_ALLOW_PRIVATE !== '1' && (u.protocol !== 'https:' || !/(^|\.)(pexels\.com|vimeo\.com|vimeocdn\.com)$/i.test(u.hostname))) throw new Error('허용되지 않은 소재 주소입니다');   // 시험 모드만 예외
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(180000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u); continue; }
    if (!r.ok) throw new Error(`소재를 내려받지 못했습니다 (${r.status})`);
    return streamTo(r.body, file, limit);
  }
  throw new Error('리디렉션이 너무 많습니다');
}
async function pexels(p) {
  const r = await fetch(`${env.PEXELS_BASE_URL || 'https://api.pexels.com'}${p}`, { headers: { Authorization: env.PEXELS_API_KEY }, signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r) throw Object.assign(new Error('Pexels 에 연결하지 못했습니다'), { status: 502 });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Pexels API 키가 올바르지 않습니다 (jcal-admin pexels-key)'), { status: 503 });
  if (r.status === 429) throw Object.assign(new Error('Pexels 사용량 한도(시간당 200회)에 걸렸습니다. 잠시 뒤 다시 시도하세요'), { status: 429 });
  if (!r.ok) throw Object.assign(new Error(`Pexels 오류 (${r.status})`), { status: 502 });
  return r.json();
}
/** 세로 1080×1920 에 가까운 파일 고르기 */
const bestVideoFile = v => {
  const files = (v.video_files || []).filter(f => f.link && f.width && f.height && /mp4/.test(f.file_type || 'mp4'));
  const portrait = files.filter(f => f.height >= f.width);
  const pool = (portrait.length ? portrait : files).filter(f => Math.max(f.width, f.height) <= 2400);
  return (pool.length ? pool : files).sort((a, b) => Math.abs(Math.min(a.width, a.height) - 1080) - Math.abs(Math.min(b.width, b.height) - 1080))[0];
};
const pexVideo = v => { const f = bestVideoFile(v); return { id: String(v.id), type: 'video', thumb: v.image, width: f?.width || v.width, height: f?.height || v.height, duration: v.duration, credit: v.user?.name || '', page: v.url }; };
const pexImage = p => ({ id: String(p.id), type: 'image', thumb: p.src?.medium || p.src?.small, width: p.width, height: p.height, duration: null, credit: p.photographer || '', page: p.url });

/* ── 경로 ── */
export function assetRoutes({ pool, tx, adminUser, HttpError }) {
  const user = adminUser;
  const uuidOk = v => /^[0-9a-f-]{36}$/i.test(String(v || ''));
  const need = v => { if (!uuidOk(v)) throw new HttpError(400, 'id 가 올바르지 않습니다'); return v; };
  const own = async (table, id, uid) => { const { rows } = await pool.query(`SELECT * FROM jcal.${table} WHERE id = $1 AND user_id = $2`, [need(id), uid]); if (!rows[0]) throw new HttpError(404, '없는 항목입니다'); return rows[0]; };
  const room = async (uid, add) => { const used = await usage(pool, uid); if (used + add > QUOTA) throw new HttpError(413, `저장 공간이 모자랍니다 (${Math.round(used / 1048576)}MB / ${Math.round(QUOTA / 1048576)}MB). 안 쓰는 소재를 지워 주세요`); };

  const raw = {
    /** 소재 올리기: 본문을 그대로 파일로 */
    'POST /api/shorts/upload': async req => {
      const u = await user(req);
      const name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')).replace(/[\\/]/g, '_').slice(0, 200);
      const ext = (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
      const mime = String(req.headers['content-type'] || '');
      const kind = kindOf(ext, mime);
      if (!kind || !ext) throw new HttpError(415, '영상(mp4 · mov · webm), 이미지(jpg · png · webp), 음악(mp3 · m4a · wav) 파일만 올릴 수 있습니다');
      const len = Number(req.headers['content-length'] || 0);
      if (len > MAX_UPLOAD) throw new HttpError(413, `파일이 너무 큽니다 (${MAX_UPLOAD / 1048576}MB 까지)`);
      await room(u.id, len);
      const id = crypto.randomUUID();
      await userDir(u.id);
      let size;
      try { size = await streamTo(req, fileOf({ id, user_id: u.id, ext }), MAX_UPLOAD); }
      catch (e) { throw new HttpError(e.status || 400, e.message); }
      const a = await register(pool, { id, uid: u.id, kind, ext, name: name.replace(/\.[^.]+$/, ''), size });
      return { asset: assetOut(a) };
    },
    /** 파일 · 미리보기 (서명 확인, 이어받기 Range 지원) */
    'GET /api/shorts/file': async (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const id = q.get('id'), k = ['thumb', 'render', 'rthumb'].includes(q.get('k')) ? q.get('k') : 'file', exp = Number(q.get('exp')), sig = q.get('sig') || '';
      const good = sign(id, k, exp);
      if (!uuidOk(id) || !(exp > Date.now() / 1000) || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) throw new HttpError(403, '주소가 만료되었습니다. 화면을 새로고침하세요');
      const isRender = k === 'render' || k === 'rthumb';
      const { rows } = await pool.query(isRender ? "SELECT id, user_id, created_at FROM jcal.shorts_renders WHERE id = $1 AND status = 'done'" : 'SELECT * FROM jcal.shorts_assets WHERE id = $1', [id]);
      if (!rows[0]) throw new HttpError(404, isRender ? '없는 영상입니다' : '없는 소재입니다');
      const a = rows[0], file = isRender ? renderPath(a.user_id, a.id, k) : fileOf(a, k);
      const st = await fsp.stat(file).catch(() => null);
      if (!st) throw new HttpError(404, '파일이 없습니다');
      const type = k === 'thumb' || k === 'rthumb' ? 'image/jpeg' : k === 'render' ? 'video/mp4' : a.mime;
      const m = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
      const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
      if (k === 'render' && q.get('dl') === '1') {                // 내려받기: 영문 파일 이름 (한글 이름은 내려받기 오류가 날 수 있음)
        const t = new Date(a.created_at), p2 = n => String(n).padStart(2, '0');
        head['Content-Disposition'] = `attachment; filename="shorts-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}.mp4"`;
      }
      if (m && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2])), end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
        if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return RAW; }
        res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...head, 'Content-Length': st.size });
        fs.createReadStream(file).pipe(res);
      }
      return RAW;
    },
  };

  const json = {
    'POST /api/shorts/asset': async (req, body) => {
      const u = await user(req);
      const a = await own('shorts_assets', body.id, u.id);
      if (body.remove) {
        await pool.query('DELETE FROM jcal.shorts_assets WHERE id = $1', [a.id]);
        await pool.query('UPDATE jcal.shorts_projects SET backgrounds = array_remove(backgrounds, $1::uuid) WHERE user_id = $2', [a.id, u.id]);
        await Promise.all([fsp.rm(fileOf(a), { force: true }), fsp.rm(fileOf(a, 'thumb'), { force: true })]);   // 이미 만든 영상은 그대로 남음
        return { ok: true };
      }
      await pool.query('UPDATE jcal.shorts_assets SET name = $2, tags = $3 WHERE id = $1', [a.id, body.name !== undefined ? String(body.name).slice(0, 200) : a.name, body.tags !== undefined ? String(body.tags).replace(/[,#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : a.tags]);
      return { ok: true };
    },

    'POST /api/shorts/pexels': async (req, body) => {
      await user(req);
      if (!pexelsReady()) throw new HttpError(503, 'Pexels 키가 서버에 없습니다. VPS 터미널에서 jcal-admin pexels-key 로 넣어 주세요');
      const query = String(body.query || '').trim().slice(0, 100);
      if (!query) throw new HttpError(400, '검색어를 넣어 주세요');
      const page = Math.max(1, Math.min(20, Number(body.page) || 1));
      try {
        if (body.type === 'image') { const j = await pexels(`/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=18&page=${page}`); return { items: (j.photos || []).map(pexImage), total: j.total_results || 0 }; }
        const j = await pexels(`/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=18&page=${page}`);
        return { items: (j.videos || []).map(pexVideo), total: j.total_results || 0 };
      } catch (e) { throw new HttpError(e.status || 502, e.message); }
    },

    'POST /api/shorts/pexels/save': async (req, body) => {
      const u = await user(req);
      if (!pexelsReady()) throw new HttpError(503, 'Pexels 키가 서버에 없습니다');
      const pid = String(body.id || '').replace(/\D/g, '');
      if (!pid) throw new HttpError(400, 'id 가 올바르지 않습니다');
      const ex = await pool.query("SELECT id FROM jcal.shorts_assets WHERE user_id = $1 AND source = 'pexels' AND source_url ~ $2", [u.id, `[-/]${pid}/$`]);   // …/office-111/ · …/111/
      if (ex.rowCount) throw new HttpError(409, '이미 소재함에 있습니다');
      let item, link, kind, ext;
      try {
        if (body.type === 'image') { const p = await pexels(`/v1/photos/${pid}`); item = pexImage(p); link = p.src?.large2x || p.src?.original; kind = 'image'; ext = 'jpg'; }
        else { const v = await pexels(`/videos/videos/${pid}`); item = pexVideo(v); link = bestVideoFile(v)?.link; kind = 'video'; ext = 'mp4'; }
      } catch (e) { throw new HttpError(e.status || 502, e.message); }
      if (!link) throw new HttpError(404, '내려받을 파일이 없습니다');
      await room(u.id, 50 * 1048576);
      const id = crypto.randomUUID();
      await userDir(u.id);
      let size;
      try { size = await download(link, fileOf({ id, user_id: u.id, ext }), MAX_UPLOAD); }
      catch (e) { throw new HttpError(e.status || 502, e.message); }
      const query = String(body.query || '').trim().slice(0, 100);
      const a = await register(pool, { id, uid: u.id, kind, ext, name: `Pexels ${query || pid}`, size, source: 'pexels', sourceUrl: item.page ? (item.page.endsWith('/') ? item.page : `${item.page}/`) : `https://www.pexels.com/${pid}/`, credit: item.credit, tags: query });
      return { asset: assetOut(a) };
    },

    'POST /api/shorts/keywords': async (req, body) => {
      const u = await user(req);
      const s = await own('shorts_scripts', body.scriptId, u.id);
      let out;
      try {
        out = await askJson(`아래 숏폼 스크립트의 배경 영상을 무료 소재 사이트(Pexels)에서 찾으려 합니다.
- keywords: 장면을 떠올리게 하는 영어 검색어 5개 (각 1~3단어, 구체적인 장면 · 사물 · 장소, 사람 얼굴이 크게 나오지 않는 것)
- mood: 배경음악 분위기 하나 (${MOODS.join(', ')} 중)

제목: ${s.title}
스크립트: ${s.script}`, {
          system: '당신은 숏폼 영상 편집자입니다. 정해진 JSON 형식으로만 답합니다.', name: 'asset_keywords',
          schema: { type: 'object', additionalProperties: false, required: ['keywords', 'mood'], properties: { keywords: { type: 'array', items: { type: 'string' } }, mood: { type: 'string', enum: MOODS } } },
        });
      } catch (e) { throw new HttpError(e.status || 502, e.message); }
      const keywords = (out.keywords || []).map(k => String(k).trim()).filter(Boolean).slice(0, 6).join(', ');
      const mood = MOODS.includes(out.mood) ? out.mood : '';
      await pool.query(`INSERT INTO jcal.shorts_projects (user_id, script_id, keywords, mood) VALUES ($1, $2, $3, $4)
        ON CONFLICT (script_id) DO UPDATE SET keywords = EXCLUDED.keywords, mood = EXCLUDED.mood, updated_at = now()`, [u.id, s.id, keywords, mood]);
      return { keywords, mood };
    },

    'POST /api/shorts/project': async (req, body) => {
      const u = await user(req);
      const s = await own('shorts_scripts', body.scriptId, u.id);
      const ids = Array.isArray(body.backgrounds) ? body.backgrounds.filter(uuidOk).slice(0, 60) : null;
      if (ids && ids.length) {
        const { rows } = await pool.query("SELECT id FROM jcal.shorts_assets WHERE user_id = $1 AND id = ANY($2::uuid[]) AND kind IN ('video', 'image')", [u.id, [...new Set(ids)]]);
        const okIds = new Set(rows.map(r => r.id));
        if (ids.some(i => !okIds.has(i))) throw new HttpError(400, '배경은 내 소재함의 영상 · 이미지만 고를 수 있습니다');
      }
      let music = body.musicId === undefined ? undefined : body.musicId || null;
      if (music) { const m = await own('shorts_assets', music, u.id); if (m.kind !== 'music') throw new HttpError(400, '배경음악은 음악 소재만 고를 수 있습니다'); }
      await pool.query(`INSERT INTO jcal.shorts_projects (user_id, script_id, backgrounds, music_id, keywords, mood) VALUES ($1, $2, COALESCE($3::uuid[], '{}'), $4, COALESCE($5, ''), COALESCE($6, ''))
        ON CONFLICT (script_id) DO UPDATE SET backgrounds = COALESCE($3::uuid[], jcal.shorts_projects.backgrounds),
          music_id = CASE WHEN $7 THEN $4 ELSE jcal.shorts_projects.music_id END,
          keywords = COALESCE($5, jcal.shorts_projects.keywords), mood = COALESCE($6, jcal.shorts_projects.mood), updated_at = now()`,
      [u.id, s.id, ids, music ?? null, body.keywords !== undefined ? String(body.keywords).slice(0, 300) : null, body.mood !== undefined ? String(body.mood).slice(0, 30) : null, music !== undefined]);
      return { ok: true };
    },
  };
  return { raw, json };
}
export const RAW = Symbol('raw');
/** GET /api/shorts 에 붙일 2차 데이터 */
export async function assetData(pool, uid) {
  const [assets, projects, used] = await Promise.all([
    pool.query('SELECT * FROM jcal.shorts_assets WHERE user_id = $1 ORDER BY created_at DESC', [uid]),
    pool.query('SELECT script_id, backgrounds, music_id, keywords, mood, status, updated_at FROM jcal.shorts_projects WHERE user_id = $1', [uid]),
    usage(pool, uid),
  ]);
  return { assets: assets.rows.map(assetOut), projects: projects.rows, storage: { used, quota: QUOTA, maxUpload: MAX_UPLOAD, ffmpeg: hasFfmpeg }, pexels: { ready: pexelsReady() } };
}
