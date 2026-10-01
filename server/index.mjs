/* Jcalender API 서버 (VPS) — 로그인 · 동기화
   GET  /api/health                  서버 · DB 상태
   GET  /api/config                                 → { signup: 'code' | 'open' | 'closed' }
   POST /api/signup  {email, password, name, code, device} → { token, user, expiresAt }   (초대 코드 방식이면 code 필요)
   POST /api/login   {email, password, device}     → { token, user, expiresAt }
   POST /api/password {current, next}               비밀번호 바꾸기 (다른 기기는 로그아웃)
   POST /api/logout                                 (Authorization: Bearer <token>)
   GET  /api/me                                     → { user, snapshot: { version, updatedAt, device } }
   GET  /api/sync                                   → { version, updatedAt, device, data }   (data 없으면 null)
   PUT  /api/sync    {baseVersion, data, device, force}
        → 200 { version, updatedAt, tables }   서버 버전이 baseVersion 과 같을 때 (또는 force)
        → 409 { version, updatedAt, device, data }   다른 기기가 먼저 올렸을 때 (서버 최신본을 돌려줌)
   동기화 단위는 "앱 데이터 전체(비밀 정보 제외)". 올릴 때마다 db/convert.mjs 규칙으로 47개 표도 함께 갱신한다. */
import http from 'http';
import { config } from './config.mjs';
import { pool, tx } from './db.mjs';
import crypto from 'crypto';
import { hashPassword, newToken, tokenHash, verifyPassword } from './auth.mjs';
import { storeToSql } from '../db/convert.mjs';

const VERSION = '1.1.0';

/* ── 공통 ── */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const originOk = o => !!o && config.origins.some(p => p === o || (p.includes('*') && new RegExp(`^${p.split('*').map(x => x.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('[a-z0-9-]+')}$`, 'i').test(o)));

function send(req, res, status, body) {
  const o = req.headers.origin;
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  if (originOk(o)) Object.assign(h, { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Max-Age': '600' });
  res.writeHead(status, h);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  const max = config.maxBodyMb * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new HttpError(413, `데이터가 너무 큽니다 (${config.maxBodyMb}MB 이하)`)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON 형식이 아닙니다')); }
    });
    req.on('error', reject);
  });
}

const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const cleanDevice = d => String(d || '').replace(/[\u0000-\u001f]/g, '').slice(0, 100);

/* 로그인 실패 제한: IP+이메일당 15분에 10번 */
const fails = new Map();
const FAIL_WINDOW = 15 * 60 * 1000, FAIL_MAX = 10;
function checkFails(key) {
  const f = fails.get(key);
  if (f && Date.now() - f.first < FAIL_WINDOW && f.n >= FAIL_MAX) throw new HttpError(429, '로그인 실패가 많습니다. 15분 뒤에 다시 시도하세요');
}
function addFail(key) {
  const f = fails.get(key);
  if (!f || Date.now() - f.first >= FAIL_WINDOW) fails.set(key, { first: Date.now(), n: 1 }); else f.n++;
}
setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (now - f.first >= FAIL_WINDOW) fails.delete(k); }, FAIL_WINDOW).unref();

async function authUser(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) throw new HttpError(401, '로그인이 필요합니다');
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, s.id AS sid FROM jcal.sessions s JOIN jcal.users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(m[1])]);
  if (!rows[0]) throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인하세요');
  return rows[0];
}

/** 비밀 정보는 서버에 두지 않는다 (앱도 떼어 내고 보내지만 한 번 더) */
function stripSecrets(d) {
  const out = { ...d };
  if (out.cardAi) out.cardAi = { ...out.cardAi, apiKey: '', token: '' };
  if (out.plan?.feeds) out.plan = { ...out.plan, feeds: out.plan.feeds.map(f => ({ ...f, token: '' })) };
  return out;
}
const isStore = d => d && typeof d === 'object' && !Array.isArray(d) && ('done' in d || 'events' in d);

async function newSession(c, req, userId, device) {
  const token = newToken();
  const s = await c.query(`INSERT INTO jcal.sessions (user_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING expires_at`,
    [userId, tokenHash(token), cleanDevice(device || req.headers['user-agent']), config.sessionDays]);
  await c.query('UPDATE jcal.users SET last_login_at = now() WHERE id = $1', [userId]);
  await c.query('DELETE FROM jcal.sessions WHERE user_id = $1 AND expires_at < now()', [userId]);
  return { token, expiresAt: s.rows[0].expires_at };
}
async function signupSettings() {
  const { rows } = await pool.query("SELECT key, value FROM jcal.server_settings WHERE key IN ('signup_mode', 'signup_code')");
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const mode = ['code', 'open', 'closed'].includes(m.signup_mode) ? m.signup_mode : 'closed';
  return { mode: mode === 'code' && !m.signup_code ? 'closed' : mode, code: m.signup_code || '' };
}
const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/* ── 경로 ── */
const routes = {
  'GET /api/health': async () => {
    const { rows } = await pool.query('SELECT now() AS now');
    return { ok: true, version: VERSION, time: rows[0].now };
  },

  'GET /api/config': async () => ({ signup: (await signupSettings()).mode }),

  'POST /api/signup': async (req, body) => {
    const email = String(body.email || '').trim().toLowerCase(), pw = String(body.password || ''), name = String(body.name || '').trim().slice(0, 100);
    const key = `${clientIp(req)}|signup`;
    checkFails(key);
    const set = await signupSettings();
    if (set.mode === 'closed') throw new HttpError(403, '지금은 회원가입을 받지 않습니다. 관리자에게 문의하세요');
    if (set.mode === 'code' && !sameText(String(body.code || '').trim(), set.code)) { addFail(key); throw new HttpError(403, '초대 코드가 맞지 않습니다'); }
    if (!EMAIL_RE.test(email)) throw new HttpError(400, '이메일 형식이 아닙니다');
    if (pw.length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다');
    if (!name) throw new HttpError(400, '이름을 입력하세요');
    const hash = await hashPassword(pw);
    return tx(async c => {
      const u = await c.query(`INSERT INTO jcal.users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, email, name`, [email, name, hash]);
      if (!u.rows[0]) throw new HttpError(409, '이미 가입된 이메일입니다. 로그인하세요');
      const ses = await newSession(c, req, u.rows[0].id, body.device);
      addFail(key);                                                 // 같은 곳에서 15분에 10명까지만 가입
      return { token: ses.token, user: { email: u.rows[0].email, name: u.rows[0].name }, expiresAt: ses.expiresAt, created: true };
    });
  },

  'POST /api/password': async (req, body) => {
    const u = await authUser(req);
    const next = String(body.next || '');
    if (next.length < 8) throw new HttpError(400, '새 비밀번호는 8자 이상이어야 합니다');
    const { rows } = await pool.query('SELECT password_hash FROM jcal.users WHERE id = $1', [u.id]);
    if (!(await verifyPassword(String(body.current || ''), rows[0].password_hash))) throw new HttpError(400, '지금 비밀번호가 맞지 않습니다');
    await tx(async c => {
      await c.query('UPDATE jcal.users SET password_hash = $2 WHERE id = $1', [u.id, await hashPassword(next)]);
      await c.query('DELETE FROM jcal.sessions WHERE user_id = $1 AND id <> $2', [u.id, u.sid]);
    });
    return { ok: true };
  },

  'POST /api/login': async (req, body) => {
    const email = String(body.email || '').trim().toLowerCase(), pw = String(body.password || '');
    if (!email || !pw) throw new HttpError(400, '이메일과 비밀번호를 입력하세요');
    const key = `${clientIp(req)}|${email}`;
    checkFails(key);
    const { rows } = await pool.query('SELECT id, email, name, password_hash FROM jcal.users WHERE lower(email) = $1', [email]);
    const u = rows[0];
    if (!u || !(await verifyPassword(pw, u.password_hash))) { addFail(key); throw new HttpError(401, '이메일 또는 비밀번호가 맞지 않습니다'); }
    fails.delete(key);
    const ses = await tx(c => newSession(c, req, u.id, body.device));
    return { token: ses.token, user: { email: u.email, name: u.name }, expiresAt: ses.expiresAt };
  },

  'POST /api/logout': async req => {
    const u = await authUser(req);
    await pool.query('DELETE FROM jcal.sessions WHERE id = $1', [u.sid]);
    return { ok: true };
  },

  'GET /api/me': async req => {
    const u = await authUser(req);
    const { rows } = await pool.query('SELECT version, updated_at, device, size_bytes FROM jcal.store_snapshots WHERE user_id = $1', [u.id]);
    const s = rows[0];
    return { user: { email: u.email, name: u.name }, snapshot: s ? { version: Number(s.version), updatedAt: s.updated_at, device: s.device, size: s.size_bytes } : null };
  },

  'GET /api/sync': async req => {
    const u = await authUser(req);
    const { rows } = await pool.query('SELECT version, updated_at, device, data FROM jcal.store_snapshots WHERE user_id = $1', [u.id]);
    const s = rows[0];
    return s ? { version: Number(s.version), updatedAt: s.updated_at, device: s.device, data: s.data } : { version: 0, updatedAt: null, device: '', data: null };
  },

  'PUT /api/sync': async (req, body, res) => {
    const u = await authUser(req);
    if (!isStore(body.data)) throw new HttpError(400, 'Jcalender 데이터가 아닙니다');
    const data = stripSecrets(body.data);
    const json = JSON.stringify(data);
    const device = cleanDevice(body.device);
    return tx(async c => {
      const cur = (await c.query('SELECT version, updated_at, device, data FROM jcal.store_snapshots WHERE user_id = $1 FOR UPDATE', [u.id])).rows[0];
      const curV = cur ? Number(cur.version) : 0;
      if (!body.force && Number(body.baseVersion ?? -1) !== curV) {
        res.conflict = true;
        return { conflict: true, version: curV, updatedAt: cur?.updated_at || null, device: cur?.device || '', data: cur?.data || null };
      }
      const r = await c.query(
        `INSERT INTO jcal.store_snapshots (user_id, version, data, device, size_bytes) VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version, data = EXCLUDED.data, device = EXCLUDED.device, size_bytes = EXCLUDED.size_bytes
         RETURNING version, updated_at`, [u.id, curV + 1, json, device, Buffer.byteLength(json)]);
      // 47개 표 갱신 — 실패해도 동기화(최신본 저장)는 유지하고 로그만 남긴다
      let tables = true;
      await c.query('SAVEPOINT tables');
      try { await c.query(storeToSql(data, { email: u.email, replace: true, tx: false }).sql); }
      catch (e) { tables = false; await c.query('ROLLBACK TO SAVEPOINT tables'); console.error(`[표 갱신 실패] ${u.email}: ${e.message}`); }
      const d = await c.query('UPDATE jcal.devices SET last_sync_at = now() WHERE user_id = $1 AND name = $2', [u.id, device]);
      if (!d.rowCount) await c.query('INSERT INTO jcal.devices (user_id, name, last_sync_at) VALUES ($1, $2, now())', [u.id, device || '이름 없음']);
      return { version: Number(r.rows[0].version), updatedAt: r.rows[0].updated_at, tables };
    });
  },
};

const server = http.createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') return send(req, res, originOk(req.headers.origin) ? 204 : 403);
  const fn = routes[`${req.method} ${path}`];
  try {
    if (!fn) throw new HttpError(404, '없는 주소입니다');
    if (req.headers.origin && !originOk(req.headers.origin)) throw new HttpError(403, `허용되지 않은 화면 주소입니다: ${req.headers.origin}`);
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const out = await fn(req, body, res);
    send(req, res, res.conflict ? 409 : 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(`[${req.method} ${path}]`, e);
    send(req, res, status, { error: status >= 500 ? '서버 오류입니다' : e.message });
  }
});

server.listen(config.port, config.host, () => console.log(`Jcalender API ${VERSION} — http://${config.host}:${config.port} (허용 화면: ${config.origins.join(', ')})`));
const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
