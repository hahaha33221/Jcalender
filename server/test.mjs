/* API 서버 점검: 빈 DB 에 서버를 띄우고 로그인 · 동기화 · 충돌 · 화면 주소 제한을 확인한다
   DATABASE_URL=postgres://… [FIXTURE=백업.json] node test.mjs */
import { spawn } from 'child_process';
import fs from 'fs';
import { pool } from './db.mjs';
import { hashPassword } from './auth.mjs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { parseFeed, htmlToText, extractBody, findFeedLink } from './shorts.mjs';
import { readWav, joinVoices, buildAss, wavFile } from './shortsRender.mjs';
import { clampVideo } from './shortsText.mjs';

const PORT = 18787, BASE = `http://127.0.0.1:${PORT}`, ORIGIN = 'https://jcalender-test.vercel.app';
const EMAIL = `test-${Date.now()}@example.com`, PW = 'test-password-1', OWNER = `owner-${Date.now()}@example.com`;
const fixture = process.env.FIXTURE ? JSON.parse(fs.readFileSync(process.env.FIXTURE, 'utf8')) : null;
const store = fixture ? (fixture.data || fixture) : {
  done: { 'r1@2026-10-01': { at: '2026-10-01 09:00' } }, prio: {}, outs: {}, log: [],
  events: [{ id: 'ev1', date: '2026-10-02', time: '10:00', title: '회의', area: 'W', repeat: { freq: 'W', until: '2026-12-31', skip: ['2026-10-09'] } }],
  people: [{ id: 'p1', name: '홍길동', group: '업무', areas: ['W', 'B'], phone: '010-1234-5678' }],
  anniv: [{ id: 'a1', name: '생일', person: '홍길동', personId: 'p1', date: '1990-10-01', kind: '생일', lunar: true }],
  finance: { expenses: [{ id: 'x1', date: '2026-10-01', amount: 12000, cat: '식비' }] },
  cardAi: { mode: 'api', apiKey: 'SHOULD-NOT-BE-STORED' },
};

const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));   // jsonb 는 키 순서를 바꾼다
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { if (cond) { ok++; console.log(`  ✓ ${name}`); } else { bad++; console.log(`  ✗ ${name} ${extra}`); } };
const call = async (method, path, body, token, origin = ORIGIN) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, cors: r.headers.get('access-control-allow-origin'), json: await r.json().catch(() => null) };
};

await pool.query(`INSERT INTO jcal.users (email, name, password_hash) VALUES ($1, '테스트', $2)`, [EMAIL, await hashPassword(PW)]);
// 숏폼 2차 시험용 소재 (ffmpeg 가 있으면 진짜 영상 · 음악, 없으면 가짜 바이트)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jcal-test-'));
const HAS_FF = (() => { try { return spawnSync('ffmpeg', ['-version']).status === 0; } catch { return false; } })();
const media = (name, args, fallback) => { const f = path.join(TMP, name); if (HAS_FF) spawnSync('ffmpeg', ['-y', '-v', 'error', ...args, f]); if (!fs.existsSync(f)) fs.writeFileSync(f, fallback); return f; };
const VID = media('v.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=15:duration=2', '-pix_fmt', 'yuv420p'], Buffer.alloc(2000, 1));
const IMG = media('p.jpg', ['-f', 'lavfi', '-i', 'color=c=blue:s=400x600', '-frames:v', '1'], Buffer.alloc(500, 2));
const MP3 = media('m.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3'], Buffer.alloc(800, 3));
// 숏폼 시험용: 가짜 게시판(RSS · 글 페이지) + 가짜 OpenAI API (실제 AI 호출 없음)
const FAKE = 18788, F = `http://127.0.0.1:${FAKE}`;
const aiCalls = [], ttsCalls = [];
let ttsFail = 0;
const soc = { gToken: [], ytMeta: null, ytBytes: 0, ytAuth: '', ytQuota: false, igMedia: null, igFetch: null, revoked: 0 };   // 가짜 Google · YouTube · Instagram
/** 가짜 음성: 앞 0.3초 조용 + 글자당 0.08초 소리 + 뒤 0.4초 조용 (24kHz 모노 WAV) */
const fakeWav = text => { const rate = 24000, on = Math.round(String(text).replace(/\s/g, '').length * 0.08 * rate), pre = 0.3 * rate, post = 0.4 * rate;
  const pcm = Buffer.alloc((pre + on + post) * 2); for (let i = 0; i < on; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), (pre + i) * 2); return wavFile(pcm, rate, 1); };
const eucKr = Buffer.from('3c3f786d6c2076657273696f6e3d22312e302220656e636f64696e673d226575632d6b72223f3e3c7273733e3c6368616e6e656c3e3c6974656d3e3c7469746c653ec7d1b1dbc1a6b8f13c2f7469746c653e3c6c696e6b3e687474703a2f2f3132372e302e302e313a31383738382f706f73742f6b723c2f6c696e6b3e3c6465736372697074696f6e3ebabbb9ae3c2f6465736372697074696f6e3e3c2f6974656d3e3c2f6368616e6e656c3e3c2f7273733e', 'hex');   // EUC-KR: 한글제목 / 본문
const fake = http.createServer((req, res) => {
  if (req.url === '/feed.xml') { res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' }); return res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>시험 게시판</title>
    <item><title><![CDATA[회사에서 생긴 일 &amp; 반전]]></title><link>${F}/post/1</link><pubDate>Sat, 03 Oct 2026 10:00:00 +0900</pubDate><description><![CDATA[<p>짧은 요약</p>]]></description></item>
    <item><title>두 번째 글</title><link>${F}/post/2</link><description>&lt;b&gt;굵게&lt;/b&gt; 본문 둘</description></item></channel></rss>`); }
  if (req.url === '/euc.xml') { res.writeHead(200, { 'Content-Type': 'text/xml' }); return res.end(eucKr); }
  if (req.url === '/board') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>게시판</body></html>`); }
  if (req.url === '/nofeed') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body>RSS 없음</body></html>'); }
  if (req.url.startsWith('/post/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(`<html><body><nav>메뉴</nav><article><h1>제목</h1><p>${'본문 내용이 아주 깁니다. '.repeat(12)}</p><script>x()</script></article></body></html>`); }
  if (req.url.startsWith('/pexels/')) {                     // 가짜 Pexels
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const vid = { id: 111, url: 'https://www.pexels.com/video/office-111/', image: `${F}/media/p.jpg`, duration: 2, width: 360, height: 640, user: { name: '촬영자A' },
      video_files: [{ link: `${F}/media/wide.mp4`, width: 1920, height: 1080, file_type: 'video/mp4' }, { link: `${F}/media/v.mp4`, width: 1080, height: 1920, file_type: 'video/mp4' }] };
    const pho = { id: 222, url: 'https://www.pexels.com/photo/desk-222/', width: 400, height: 600, photographer: '촬영자B', src: { medium: `${F}/media/p.jpg`, large2x: `${F}/media/p.jpg` } };
    if (req.url.startsWith('/pexels/videos/search')) return res.end(JSON.stringify({ total_results: 1, videos: [vid] }));
    if (req.url.startsWith('/pexels/videos/videos/111')) return res.end(JSON.stringify(vid));
    if (req.url.startsWith('/pexels/v1/search')) return res.end(JSON.stringify({ total_results: 1, photos: [pho] }));
    if (req.url.startsWith('/pexels/v1/photos/222')) return res.end(JSON.stringify(pho));
    res.writeHead(404); return res.end('{}');
  }
  if (req.url.startsWith('/media/')) { const f = { '/media/v.mp4': VID, '/media/p.jpg': IMG }[req.url]; if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': req.url.endsWith('mp4') ? 'video/mp4' : 'image/jpeg' }); return res.end(fs.readFileSync(f)); }
  if (/^\/(google|youtube|upload|ig|graph)\//.test(req.url)) {
    let b = ''; req.on('data', c => { b += c.length > 2000 ? '' : c; soc.ytBytes += req.url.startsWith('/upload/session') ? c.length : 0; }); req.on('end', async () => {
      const u = new URL(req.url, F), q = u.searchParams, fb = new URLSearchParams(b), J = (o, st = 200, h = {}) => { res.writeHead(st, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/google/token') { soc.gToken.push(Object.fromEntries(fb));
        if (fb.get('grant_type') === 'authorization_code') return fb.get('code') === 'good' ? J({ access_token: 'g-acc-1', refresh_token: 'g-ref', expires_in: 30 }) : J({ error: 'invalid_grant' }, 400);
        return fb.get('refresh_token') === 'g-ref' ? J({ access_token: 'g-acc-2', expires_in: 3600 }) : J({ error: 'invalid_grant' }, 400); }
      if (u.pathname === '/google/revoke') { soc.revoked++; return J({}); }
      if (u.pathname === '/youtube/v3/channels') return req.headers.authorization === 'Bearer g-acc-1' ? J({ items: [{ id: 'UC123', snippet: { title: '내 채널', customUrl: '@mych' } }] }) : J({ error: { message: 'auth' } }, 401);
      if (u.pathname === '/upload/youtube/v3/videos') { soc.ytAuth = req.headers.authorization; soc.ytMeta = JSON.parse(b); soc.ytBytes = 0;
        if (soc.ytQuota) return J({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'quota' } }, 403);
        res.writeHead(200, { Location: `${F}/upload/session/1` }); return res.end(); }
      if (u.pathname === '/upload/session/1') return J({ id: 'yt-vid-1', status: { uploadStatus: 'uploaded' } });
      if (u.pathname === '/youtube/v3/videos') return J({ items: q.get('id').split(',').map(id => ({ id, statistics: { viewCount: '1234', likeCount: '56', commentCount: '7' } })) });
      if (u.pathname === '/ig/oauth/access_token') return fb.get('code') === 'good' ? J({ access_token: 'ig-short', user_id: 1784 }) : J({ error_message: 'bad code' }, 400);
      if (u.pathname === '/graph/access_token') return J({ access_token: 'ig-long', token_type: 'bearer', expires_in: 5184000 });
      if (u.pathname === '/graph/v23.0/me') return J({ user_id: '17841400000', username: 'my_ig', account_type: 'BUSINESS' });
      if (u.pathname === '/graph/v23.0/17841400000/media') { soc.igMedia = Object.fromEntries(fb);
        const v = await fetch(fb.get('video_url')).catch(() => null); soc.igFetch = v ? { status: v.status, bytes: (await v.arrayBuffer()).byteLength } : null; return J({ id: 'cont-1' }); }
      if (u.pathname === '/graph/v23.0/cont-1') return J({ status_code: 'FINISHED' });
      if (u.pathname === '/graph/v23.0/17841400000/media_publish') return J({ id: 'ig-media-1' });
      if (u.pathname === '/graph/v23.0/ig-media-1') return J(q.get('fields') === 'permalink' ? { permalink: 'https://www.instagram.com/reel/abc/' } : { like_count: 10, comments_count: 2 });
      if (u.pathname === '/graph/v23.0/ig-media-1/insights') return J({ data: [{ name: 'views', values: [{ value: 500 }] }, { name: 'reach', values: [{ value: 300 }] }, { name: 'saved', values: [{ value: 4 }] }, { name: 'shares', values: [{ value: 3 }] }] });
      J({ error: { message: 'not found' } }, 404);
    }); return;
  }
  if (req.url === '/v1/audio/speech') {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      const j = JSON.parse(b); ttsCalls.push({ headers: req.headers, body: j });
      if (ttsFail) { res.writeHead(ttsFail, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 'invalid_api_key', message: 'bad key' } })); }
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(fakeWav(j.input));
    }); return;
  }
  if (req.url === '/v1/chat/completions') {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      aiCalls.push({ url: req.url, headers: req.headers, body: JSON.parse(b) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (JSON.parse(b).response_format?.json_schema?.name === 'goal_todos') return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', refusal: null, content: JSON.stringify({ goals: [{ index: 0, guide: '주간 거리를 천천히 늘리세요.', tips: ['무리하지 않기', ''],
        milestones: [{ name: '5km 완주', date: '2026-11-15' }, { name: '범위 밖', date: '2030-01-01' }], todos: [{ name: '러닝화 사기', start: '2026-10-08', end: '2026-10-10', how: '매장에서 신어 보기' }, { name: '주 3회 3km', start: '2026-10-01', end: '2026-12-31', how: '' }] }] }) } }] }));
      if (JSON.parse(b).response_format?.json_schema?.name === 'asset_keywords') return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', refusal: null, content: JSON.stringify({ keywords: ['office desk', 'meeting room'], mood: '긴장' }) } }] }));
      res.end(JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion', model: 'gpt-5-mini', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', refusal: null,
        content: JSON.stringify({ candidates: [{ title: '회사에서 생긴 반전', script: '여러분 이거 실화입니다. 어떻게 생각하세요?', hashtags: ['#회사', '썰'] }, { title: '두 번째 후보', script: '스크립트 둘', hashtags: [] }] }) } }] }));
    }); return;
  }
  res.writeHead(404); res.end();
});
await new Promise(r => fake.listen(FAKE, '127.0.0.1', r));
const srv = spawn(process.execPath, ['index.mjs'], { env: { ...process.env, PORT: String(PORT), ALLOWED_ORIGINS: 'https://*.vercel.app', OWNER_EMAILS: OWNER,
  SHORTS_ALLOW_PRIVATE: '1', SHORTS_CRON: '0', OPENAI_API_KEY: 'sk-test-key', OPENAI_BASE_URL: `${F}/v1`, ANTHROPIC_API_KEY: '', AI_PROVIDER: '',
  PEXELS_API_KEY: 'test-pexels-key', YOUTUBE_CLIENT_ID: 'test.apps.googleusercontent.com', YOUTUBE_CLIENT_SECRET: 'gsecret', INSTAGRAM_APP_ID: '123456', INSTAGRAM_APP_SECRET: 'igsecret', SOCIAL_TEST_BASE: F, SHORTS_PRESETS: JSON.stringify([{ id: 'pa', name: '시험 추천 A', desc: 'd', fullText: false, urls: [`${F}/nofeed-404`, `${F}/euc.xml`] }, { id: 'pb', name: '시험 추천 B', desc: 'd', urls: [`${F}/nofeed`] }, { id: 'pc', name: '시험 추천 C', desc: 'd', urls: [`${F}/feed.xml`] }]), PUBLIC_URL: BASE, IG_POLL_MS: '200', PEXELS_BASE_URL: `${F}/pexels`, SHORTS_DIR: path.join(TMP, 'store'), SHORTS_MAX_UPLOAD_MB: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.once('data', r));

try {
  console.log('서버 · 로그인');
  const h = await call('GET', '/api/health');
  check('health', h.status === 200 && h.json.ok);
  check('허용된 화면 주소에 CORS 헤더', h.cors === ORIGIN);
  check('다른 화면 주소는 거절', (await call('GET', '/api/health', null, null, 'https://evil.example.com')).status === 403);
  check('틀린 비밀번호 401', (await call('POST', '/api/login', { email: EMAIL, password: 'wrong' })).status === 401);
  const login = await call('POST', '/api/login', { email: EMAIL.toUpperCase(), password: PW, device: '테스트 기기' });
  check('로그인 (이메일 대소문자 무시)', login.status === 200 && login.json.token, JSON.stringify(login.json));
  const T = login.json.token;
  const [{ n }] = (await pool.query('SELECT count(*)::int AS n FROM jcal.sessions s JOIN jcal.users u ON u.id = s.user_id WHERE u.email = $1 AND s.token_hash::text LIKE $2', [EMAIL, `%${Buffer.from(T).toString('hex')}%`])).rows;
  check('토큰 원문은 DB 에 없음', n === 0);
  check('토큰 없이 401', (await call('GET', '/api/sync')).status === 401);

  console.log('동기화');
  const g0 = await call('GET', '/api/sync', null, T);
  check('처음엔 버전 0 · 데이터 없음', g0.json.version === 0 && g0.json.data === null);
  const p1 = await call('PUT', '/api/sync', { baseVersion: 0, data: store, device: '맥북' }, T);
  check('올리기 → 버전 1', p1.status === 200 && p1.json.version === 1, JSON.stringify(p1.json));
  check('47개 표도 갱신', p1.json.tables === true);
  const g1 = await call('GET', '/api/sync', null, T);
  check('받기 = 올린 데이터', g1.json.version === 1 && canon(g1.json.data.events) === canon(store.events) && canon(g1.json.data.people) === canon(store.people));
  check('비밀 정보는 저장 안 됨', !JSON.stringify(g1.json.data).includes('SHOULD-NOT-BE-STORED'));
  const uid = (await pool.query('SELECT id FROM jcal.users WHERE email = $1', [EMAIL])).rows[0].id;
  const cnt = async t => (await pool.query(`SELECT count(*)::int AS n FROM jcal.${t} WHERE user_id = $1`, [uid])).rows[0].n;
  check('표: events 행 수', await cnt('events') === store.events.filter(e => e.id && e.date).length);
  check('표: people 행 수', await cnt('people') === (store.people || []).length);

  const p2 = await call('PUT', '/api/sync', { baseVersion: 0, data: { ...store, events: [] }, device: '휴대폰' }, T);
  check('오래된 버전으로 올리면 409 + 서버 최신본', p2.status === 409 && p2.json.version === 1 && p2.json.data && p2.json.device === '맥북');
  const p3 = await call('PUT', '/api/sync', { baseVersion: 1, data: { ...store, events: [] }, device: '휴대폰' }, T);
  check('최신 버전 기준으로 올리면 버전 2', p3.status === 200 && p3.json.version === 2);
  check('앱에서 지운 일정은 표에서도 빠짐', await cnt('events') === 0);
  const p4 = await call('PUT', '/api/sync', { baseVersion: 0, data: store, device: '맥북', force: true }, T);
  check('force 덮어쓰기 → 버전 3', p4.status === 200 && p4.json.version === 3);
  check('잘못된 데이터 400', (await call('PUT', '/api/sync', { baseVersion: 3, data: { foo: 1 } }, T)).status === 400);
  const me = await call('GET', '/api/me', null, T);
  check('me: 버전 · 기기', me.json.snapshot.version === 3 && me.json.snapshot.device === '맥북');

  console.log('회원가입 · 사용자별 분리');
  const prevSet = (await pool.query('SELECT key, value FROM jcal.server_settings')).rows;
  const setS = (k, v) => pool.query('INSERT INTO jcal.server_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, v]);
  await setS('signup_mode', 'code'); await setS('signup_code', 'TEST-CODE');
  check('config: 초대 코드 방식', (await call('GET', '/api/config')).json.signup === 'code');
  const E2 = `new-${Date.now()}@example.com`;
  check('틀린 초대 코드 403', (await call('POST', '/api/signup', { email: E2, password: 'pw-12345678', name: '새사람', code: 'WRONG' })).status === 403);
  check('짧은 비밀번호 400', (await call('POST', '/api/signup', { email: E2, password: 'short', name: '새사람', code: 'TEST-CODE' })).status === 400);
  const su = await call('POST', '/api/signup', { email: E2, password: 'pw-12345678', name: '새사람', code: 'TEST-CODE' });
  check('가입 → 바로 로그인 토큰', su.status === 200 && su.json.token && su.json.created, JSON.stringify(su.json));
  check('같은 이메일 다시 가입 409', (await call('POST', '/api/signup', { email: E2, password: 'pw-12345678', name: '새사람', code: 'TEST-CODE' })).status === 409);
  const T2 = su.json.token;
  check('새 사용자는 빈 서버 데이터', (await call('GET', '/api/sync', null, T2)).json.data === null);
  await call('PUT', '/api/sync', { baseVersion: 0, data: { done: {}, events: [{ id: 'mine', date: '2026-10-03', title: '새사람 일정' }] }, device: '폰' }, T2);
  const g1u = (await call('GET', '/api/sync', null, T)).json, g2u = (await call('GET', '/api/sync', null, T2)).json;
  check('사용자끼리 데이터 분리', !JSON.stringify(g1u.data).includes('새사람 일정') && g2u.data.events[0].title === '새사람 일정' && g2u.version === 1);
  check('비밀번호 바꾸기: 틀린 현재 비밀번호 400', (await call('POST', '/api/password', { current: 'nope', next: 'new-pass-999' }, T2)).status === 400);
  check('비밀번호 바꾸기', (await call('POST', '/api/password', { current: 'pw-12345678', next: 'new-pass-999' }, T2)).status === 200);
  check('새 비밀번호로 로그인', (await call('POST', '/api/login', { email: E2, password: 'new-pass-999' })).status === 200);

  console.log('회원 관리 (관리자 계정만)');
  check('일반 회원은 회원 목록 403', (await call('GET', '/api/admin/users', null, T2)).status === 403);
  check('가입한 회원 권한 = member', su.json.user.role === 'member');
  await pool.query("UPDATE jcal.users SET role = 'admin' WHERE email = $1", [EMAIL]);
  check('DB 의 role 이 admin 이어도 관리자 계정이 아니면 403', (await call('GET', '/api/admin/users', null, T)).status === 403);
  await pool.query(`INSERT INTO jcal.users (email, name, password_hash) VALUES ($1, '관리자', $2)`, [OWNER, await hashPassword(PW)]);
  const TA = (await call('POST', '/api/login', { email: OWNER, password: PW })).json;
  check('관리자 계정 로그인 → role admin', TA.user?.role === 'admin');
  const ul = await call('GET', '/api/admin/users', null, TA.token);
  check('관리자 계정은 회원 목록', ul.status === 200 && ul.json.users.some(u => u.email === E2 && u.role === 'member') && ul.json.users.find(u => u.email === EMAIL)?.role === 'member', JSON.stringify(ul.json).slice(0, 200));
  check('다른 회원을 관리자로 못 바꿈', (await call('POST', '/api/admin/users', { email: E2, role: 'admin' }, TA.token)).status === 400);
  check('관리자 계정 권한은 못 바꿈', (await call('POST', '/api/admin/users', { email: OWNER, role: 'suspended' }, TA.token)).status === 400);
  check('잘못된 권한 400', (await call('POST', '/api/admin/users', { email: E2, role: 'king' }, TA.token)).status === 400);
  const T2b = (await call('POST', '/api/login', { email: E2, password: 'new-pass-999' })).json.token;
  check('정지', (await call('POST', '/api/admin/users', { email: E2, role: 'suspended' }, TA.token)).status === 200);
  check('정지하면 기존 로그인 끊김', (await call('GET', '/api/me', null, T2b)).status === 401);
  check('정지된 계정은 로그인 403', (await call('POST', '/api/login', { email: E2, password: 'new-pass-999' })).status === 403);
  await call('POST', '/api/admin/users', { email: E2, role: 'member' }, TA.token);
  const T2c = (await call('POST', '/api/login', { email: E2, password: 'new-pass-999' })).json.token;
  check('정지 풀면 다시 로그인', !!T2c);
  check('다른 회원 모든 기기 로그아웃', (await call('POST', '/api/admin/users', { email: E2, logout: true }, TA.token)).json.loggedOut >= 1 && (await call('GET', '/api/me', null, T2c)).status === 401);
  check('처음엔 모든 영역', ul.json.users.find(u => u.email === E2)?.areas === 'PBW');
  check('영역 바꾸기 (개인 · 근로)', (await call('POST', '/api/admin/users', { email: E2, areas: 'WP' }, TA.token)).json.areas === 'PW');
  const T2d = (await call('POST', '/api/login', { email: E2, password: 'new-pass-999' })).json;
  check('로그인 · me 에 영역이 보임', T2d.user?.areas === 'PW' && (await call('GET', '/api/me', null, T2d.token)).json.user.areas === 'PW');
  check('영역 0개는 400', (await call('POST', '/api/admin/users', { email: E2, areas: '' }, TA.token)).status === 400);
  check('관리자 계정 영역은 못 바꿈', (await call('POST', '/api/admin/users', { email: OWNER, areas: 'P' }, TA.token)).status === 400);
  check('회원 화면: 처음엔 꺼짐', (await call('GET', '/api/admin/screen', null, TA.token)).json.on === false);
  check('일반 회원은 회원 화면 설정 403', (await call('POST', '/api/admin/screen', { on: true }, T)).status === 403);
  const scr = await call('POST', '/api/admin/screen', { on: true, cats: ['P|건강 관리', 'B|콘텐츠 관리', 'B|콘텐츠 관리', 'X|잘못', 'P|' + 'x'.repeat(80)] }, TA.token);
  check('회원 화면 켜기 · 카테고리 정리 저장', scr.json.on === true && scr.json.cats.join() === 'P|건강 관리,B|콘텐츠 관리', JSON.stringify(scr.json));
  const meScr = (await call('POST', '/api/login', { email: E2, password: 'new-pass-999' })).json;
  check('회원 로그인 · me 에 회원 화면 설정', meScr.user?.screen?.on === true && (await call('GET', '/api/me', null, meScr.token)).json.user.screen.cats.length === 2);
  check('관리자 계정에는 회원 화면 적용 안 함', (await call('GET', '/api/me', null, TA.token)).json.user.screen === null);
  await call('POST', '/api/admin/screen', { on: false }, TA.token);
  check('끄기 (카테고리 목록은 유지)', (await call('GET', '/api/admin/screen', null, TA.token)).json.cats.length === 2);
  check('일반 회원은 가입 설정 403', (await call('GET', '/api/admin/signup', null, T)).status === 403);
  const sg = await call('POST', '/api/admin/signup', { mode: 'code', newCode: true }, TA.token);
  check('새 초대 코드', sg.status === 200 && sg.json.mode === 'code' && sg.json.code && sg.json.code !== 'TEST-CODE');

  console.log('숏폼 제작 (수집 · 고르기 · AI 스크립트)');
  const sh_items = parseFeed(`<feed><entry><title>아톰 &lt;글&gt;</title><link rel="alternate" href="/a/1"/><updated>2026-10-01T00:00:00Z</updated><content type="html">&lt;p&gt;안녕&lt;/p&gt;</content></entry></feed>`, 'https://ex.com/');
  check('Atom 읽기 (상대 주소 · 엔티티 · HTML)', sh_items[0]?.link === 'https://ex.com/a/1' && sh_items[0].title === '아톰 <글>' && sh_items[0].body === '안녕', JSON.stringify(sh_items));
  check('HTML → 글자 (script 제거 · 줄바꿈)', htmlToText('<p>가<br>나</p><script>x</script><div>다&nbsp;라</div>') === '가\n나\n다 라');
  check('본문: article 우선 · 정규식', extractBody(`<article>${'긴 본문 '.repeat(20)}</article>`).startsWith('긴 본문') && extractBody('<div id="x">찾을 글</div>', '<div id="x">([\\s\\S]*?)</div>') === '찾을 글');
  check('페이지 안 RSS 링크 찾기', findFeedLink('<link rel="alternate" type="application/rss+xml" href="/rss">', 'https://b.com/board') === 'https://b.com/rss');
  check('일반 회원은 숏폼 403', (await call('GET', '/api/shorts', null, T)).status === 403);
  check('회원 숏폼 권한 켜기 → 내 자료만 보임', (await call('POST', '/api/admin/users', { email: EMAIL, shorts: true }, TA.token)).json?.shorts === true
    && (await call('GET', '/api/me', null, T)).json.user.shorts === true && (await call('GET', '/api/shorts', null, T)).json?.sources?.length === 0);
  check('관리자 계정 숏폼 권한은 못 바꿈', (await call('POST', '/api/admin/users', { email: OWNER, shorts: false }, TA.token)).status === 400);
  check('회원 숏폼 권한 끄기 → 403', (await call('POST', '/api/admin/users', { email: EMAIL, shorts: false }, TA.token)).status === 200 && (await call('GET', '/api/shorts', null, T)).status === 403);
  const sh_T0 = TA.token;
  const sh_g0 = await call('GET', '/api/shorts', null, sh_T0);
  check('처음: 설정 기본값 · AI 준비됨 (ChatGPT)', sh_g0.status === 200 && sh_g0.json.settings.scriptChars === 350 && sh_g0.json.ai.ready === true && sh_g0.json.ai.provider === 'openai' && sh_g0.json.ai.model === 'gpt-5-mini', JSON.stringify(sh_g0.json).slice(0, 200));
  const sh_add1 = await call('POST', '/api/shorts/source', { action: 'add', url: `${F}/board`, name: '시험 게시판', fullText: true }, sh_T0);
  check('게시판 페이지 주소 → RSS 찾아 등록 + 바로 수집 2개', sh_add1.status === 200 && sh_add1.json.source.feed_url === `${F}/feed.xml` && sh_add1.json.added === 2, JSON.stringify(sh_add1.json));
  check('같은 게시판 다시 등록 409', (await call('POST', '/api/shorts/source', { action: 'add', url: `${F}/feed.xml` }, sh_T0)).status === 409);
  check('RSS 없는 페이지 400', (await call('POST', '/api/shorts/source', { action: 'add', url: `${F}/nofeed` }, sh_T0)).status === 400);
  check('http(s) 아닌 주소 400', (await call('POST', '/api/shorts/source', { action: 'add', url: 'file:///etc/passwd' }, sh_T0)).status === 400);
  const sh_add2 = await call('POST', '/api/shorts/source', { action: 'add', url: `${F}/euc.xml` }, sh_T0);
  const sh_g1 = await call('GET', '/api/shorts', null, sh_T0);
  const sh_it1 = sh_g1.json.items.find(i => i.link === `${F}/post/1`), sh_kr = sh_g1.json.items.find(i => i.link === `${F}/post/kr`);
  check('EUC-KR 게시판 글자 깨짐 없음', sh_add2.status === 200 && sh_kr?.title === '한글제목' && sh_kr.body === '본문', JSON.stringify(sh_kr));
  check('제목 엔티티 · 본문 가져오기(article)', sh_it1?.title === '회사에서 생긴 일 & 반전' && sh_it1.body.includes('본문 내용이 아주 깁니다') && !sh_it1.body.includes('메뉴') && !sh_it1.body.includes('x()'), JSON.stringify(sh_it1).slice(0, 200));
  check('다시 수집해도 중복 없음', (await call('POST', '/api/shorts/source', { action: 'fetch', id: sh_add1.json.source.id }, sh_T0)).json.added === 0);
  check('글 고르기', (await call('POST', '/api/shorts/item', { id: sh_it1.id, status: 'picked' }, sh_T0)).status === 200);
  await call('POST', '/api/shorts/settings', { scriptChars: 300, count: 2, tone: '담담하게', titleMax: 999 }, sh_T0);
  const sh_gen = await call('POST', '/api/shorts/generate', { itemId: sh_it1.id }, sh_T0);
  check('AI 스크립트 후보 2개 저장', sh_gen.status === 200 && sh_gen.json.scripts.length === 2 && sh_gen.json.scripts[0].title === '회사에서 생긴 반전' && sh_gen.json.scripts[0].hashtags === '회사 썰', JSON.stringify(sh_gen.json).slice(0, 300));
  const sh_call0 = aiCalls[0];
  check('AI 요청: ChatGPT 모델 · 키 · JSON 스키마 · 설정 반영', sh_call0 && sh_call0.body.model === 'gpt-5-mini' && sh_call0.headers.authorization === 'Bearer sk-test-key'
    && sh_call0.body.response_format?.type === 'json_schema' && sh_call0.body.response_format.json_schema.strict === true && sh_call0.body.messages[0].role === 'system'
    && sh_call0.body.messages[1].content.includes('약 300자') && sh_call0.body.messages[1].content.includes('100자 이내') && sh_call0.body.messages[1].content.includes('본문 내용이 아주'), JSON.stringify(sh_call0?.body).slice(0, 300));
  check('후보에 AI 이름 저장', sh_gen.json.scripts[0].model === 'ChatGPT · gpt-5-mini');
  const [sh_s1, sh_s2] = sh_gen.json.scripts;
  const sh_order = (await call('GET', '/api/shorts', null, sh_T0)).json.scripts.map(x => x.id).join();
  check('후보 순서가 항상 같음', sh_order === `${sh_s1.id},${sh_s2.id}`);
  await call('POST', '/api/shorts/script', { id: sh_s1.id, chosen: true }, sh_T0);
  await call('POST', '/api/shorts/script', { id: sh_s2.id, chosen: true, script: '고친 스크립트' }, sh_T0);
  const sh_g2 = (await call('GET', '/api/shorts', null, sh_T0)).json;
  check('한 글에 하나만 고름 · 고친 내용 저장', sh_g2.scripts.filter(x => x.chosen).length === 1 && sh_g2.scripts.find(x => x.chosen).id === sh_s2.id && sh_g2.scripts.find(x => x.id === sh_s2.id).script === '고친 스크립트');
  check('설정 범위 제한 (제목 100자까지)', sh_g2.settings.titleMax === 100 && sh_g2.settings.tone === '담담하게');
  check('다른 사람 항목은 404', (await call('POST', '/api/shorts/item', { id: sh_it1.id, status: 'skipped' }, T2b)).status !== 200);
  check('게시판 삭제', (await call('POST', '/api/shorts/source', { action: 'delete', id: sh_add2.json.source.id }, sh_T0)).status === 200);
  const pr = await call('POST', '/api/shorts/presets', {}, sh_T0), prr = id => pr.json?.results.find(x => x.id === id);
  check('추천 게시판 목록', (await call('GET', '/api/shorts', null, sh_T0)).json.presets.length === 3);
  check('추천 게시판 추가 (안 되는 주소는 다음 후보 · 실패 이유 · 이미 있는 곳은 건너뜀)', pr.status === 200 && prr('pa').ok && prr('pa').added >= 0 && prr('pb').ok === false && /RSS/.test(prr('pb').error) && prr('pc').skipped
    && (await call('GET', '/api/shorts', null, sh_T0)).json.sources.some(x => x.name === '시험 추천 A' && x.feed_url === `${F}/euc.xml`), JSON.stringify(pr.json));
  check('추천 게시판 다시 추가 → 건너뜀', (await call('POST', '/api/shorts/presets', { ids: ['pa'] }, sh_T0)).json.results[0].skipped === true);

  console.log(`숏폼 2차 (소재함 · Pexels · 제작 준비)${HAS_FF ? '' : ' — ffmpeg 없음: 길이 · 미리보기 확인은 건너뜀'}`);
  const a2_up = async (file, name, type, token = sh_T0) => { const r = await fetch(`${BASE}/api/shorts/upload`, { method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }, body: fs.readFileSync(file) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const a2_uv = await a2_up(VID, '사무실 영상.mp4', 'video/mp4');
  check('영상 올리기', a2_uv.status === 200 && a2_uv.json.asset.kind === 'video' && a2_uv.json.asset.name === '사무실 영상', JSON.stringify(a2_uv.json).slice(0, 200));
  if (HAS_FF) check('영상 크기 · 길이 · 미리보기 (세로 360×640, 2초)', a2_uv.json.asset.width === 360 && a2_uv.json.asset.height === 640 && Math.abs(a2_uv.json.asset.duration - 2) < 0.3 && !!a2_uv.json.asset.thumb, JSON.stringify(a2_uv.json.asset));
  const a2_ui = await a2_up(IMG, 'desk.jpg', 'image/jpeg'), a2_um = await a2_up(MP3, '잔잔한 음악.mp3', 'audio/mpeg');
  check('이미지 · 음악 올리기', a2_ui.json?.asset.kind === 'image' && a2_um.json?.asset.kind === 'music' && (!HAS_FF || Math.abs(a2_um.json.asset.duration - 3) < 0.3), JSON.stringify(a2_um.json));
  check('지원 안 하는 파일 415', (await a2_up(IMG, 'memo.txt', 'text/plain')).status === 415);
  const a2_big = path.join(TMP, 'a2_big.mp4'); fs.writeFileSync(a2_big, Buffer.alloc(1.5 * 1024 * 1024));
  const a2_bigR = await a2_up(a2_big, 'a2_big.mp4', 'video/mp4').catch(e => ({ status: /EPIPE|ECONNRESET/.test(String(e.cause?.code)) ? 'closed' : e.message }));   // 서버가 먼저 끊으면 보내던 쪽은 EPIPE
  check('너무 큰 파일 413 (1MB 제한)', a2_bigR.status === 413 || a2_bigR.status === 'closed', a2_bigR.status);
  check('일반 회원은 올리기 403', (await a2_up(IMG, 'x.jpg', 'image/jpeg', T)).status === 403);
  const a2_sg = (await call('GET', '/api/shorts', null, sh_T0)).json;
  check('목록: 소재 3개 · 저장 공간 · Pexels 준비', a2_sg.assets.length === 3 && a2_sg.storage.used > 0 && a2_sg.pexels.ready === true && a2_sg.settings.video.clipSeconds === 4, JSON.stringify(a2_sg.storage));
  const a2_va = a2_sg.assets.find(a => a.id === a2_uv.json.asset.id);
  const a2_fr = await fetch(BASE + a2_va.url);
  check('서명 주소로 영상 받기', a2_fr.status === 200 && a2_fr.headers.get('content-type') === 'video/mp4' && (await a2_fr.arrayBuffer()).byteLength === fs.statSync(VID).size);
  const a2_rr = await fetch(BASE + a2_va.url, { headers: { Range: 'bytes=0-99' } });
  check('이어받기 (Range 206)', a2_rr.status === 206 && (await a2_rr.arrayBuffer()).byteLength === 100 && /^bytes 0-99\//.test(a2_rr.headers.get('content-range')));
  check('서명이 틀리면 403', (await fetch(BASE + a2_va.url.replace(/sig=[^&]+$/, 'sig=x'))).status === 403 && (await fetch(BASE + a2_va.url.replace(/k=file/, 'k=thumb'))).status === 403);
  if (HAS_FF) check('미리보기 그림 받기', (await fetch(BASE + a2_va.thumb)).headers.get('content-type') === 'image/jpeg');
  await call('POST', '/api/shorts/asset', { id: a2_va.id, tags: '#회사, 사무실  긴장' }, sh_T0);
  check('태그 정리 저장', (await call('GET', '/api/shorts', null, sh_T0)).json.assets.find(a => a.id === a2_va.id).tags === '회사 사무실 긴장');
  const a2_px = await call('POST', '/api/shorts/pexels', { query: 'office', type: 'video' }, sh_T0);
  check('Pexels 영상 검색 (세로 · 촬영자)', a2_px.status === 200 && a2_px.json.items[0].id === '111' && a2_px.json.items[0].height === 1920 && a2_px.json.items[0].credit === '촬영자A', JSON.stringify(a2_px.json).slice(0, 200));
  const a2_pxs = await call('POST', '/api/shorts/pexels/save', { id: '111', type: 'video', query: 'office' }, sh_T0);
  check('Pexels 영상 담기 (세로 파일 골라 내려받기)', a2_pxs.status === 200 && a2_pxs.json.asset.source === 'pexels' && a2_pxs.json.asset.credit === '촬영자A' && a2_pxs.json.asset.tags === 'office' && (!HAS_FF || a2_pxs.json.asset.height === 640), JSON.stringify(a2_pxs.json).slice(0, 300));
  check('같은 Pexels 소재 다시 담기 409', (await call('POST', '/api/shorts/pexels/save', { id: '111', type: 'video' }, sh_T0)).status === 409);
  check('Pexels 사진 담기', (await call('POST', '/api/shorts/pexels/save', { id: '222', type: 'image', query: 'desk' }, sh_T0)).json?.asset?.kind === 'image');
  const a2_chosenId = sh_s2.id;
  const a2_kw = await call('POST', '/api/shorts/keywords', { scriptId: a2_chosenId }, sh_T0);
  check('AI 소재 검색어 · 분위기', a2_kw.status === 200 && a2_kw.json.keywords === 'office desk, meeting room' && a2_kw.json.mood === '긴장', JSON.stringify(a2_kw.json));
  check('배경에 음악은 못 넣음 400', (await call('POST', '/api/shorts/project', { scriptId: a2_chosenId, backgrounds: [a2_um.json.asset.id] }, sh_T0)).status === 400);
  const a2_pj = await call('POST', '/api/shorts/project', { scriptId: a2_chosenId, backgrounds: [a2_va.id, a2_ui.json.asset.id, a2_va.id], musicId: a2_um.json.asset.id }, sh_T0);
  const a2_pg = (await call('GET', '/api/shorts', null, sh_T0)).json.projects.find(x => x.script_id === a2_chosenId);
  check('제작 준비 저장 (순서 · 반복 · 음악 · 검색어 유지)', a2_pj.status === 200 && a2_pg.backgrounds.join() === [a2_va.id, a2_ui.json.asset.id, a2_va.id].join() && a2_pg.music_id === a2_um.json.asset.id && a2_pg.keywords === 'office desk, meeting room', JSON.stringify(a2_pg));
  await call('POST', '/api/shorts/settings', { video: { clipSeconds: 3.3, sub: { color: '#ff0000', lineChars: 99 } } }, sh_T0);
  const a2_vs = (await call('GET', '/api/shorts', null, sh_T0)).json.settings.video;
  check('영상 설정 저장 · 범위 제한', a2_vs.clipSeconds === 3.5 && a2_vs.sub.color === '#FF0000' && a2_vs.sub.lineChars === 30 && a2_vs.sub.font === 'Noto Sans KR', JSON.stringify(a2_vs));
  check('소재 지우기 → 파일 · 배경에서도 빠짐', (await call('POST', '/api/shorts/asset', { id: a2_va.id, remove: true }, sh_T0)).status === 200
    && (await call('GET', '/api/shorts', null, sh_T0)).json.projects.find(x => x.script_id === a2_chosenId).backgrounds.join() === a2_ui.json.asset.id && (await fetch(BASE + a2_va.url)).status === 404);

  console.log(`숏폼 3차 (영상 만들기)${HAS_FF ? '' : ' — ffmpeg 없음: 만들기는 건너뜀'}`);
  {
    const w = readWav(fakeWav('가나다라마')), j3 = joinVoices([w, readWav(fakeWav('바사'))]);
    check('음성 앞뒤 빈 소리 다듬기 · 문장 시간', Math.abs(j3.spans[0].a - 0.06) < 0.01 && Math.abs(j3.spans[0].b - 0.46) < 0.01 && Math.abs(j3.spans[1].a - (0.06 + 0.4 + 0.18 + 0.12 + 0.06)) < 0.01, JSON.stringify(j3.spans));
    const ass = buildAss({ sentences: ['여러분 이거 {실화}입니다.', '어떻게 하시겠어요?'], spans: j3.spans, speed: 1, end: 3, title: '제목', V: clampVideo({ sub: { box: true, highlight: '#FFE600' } }) });
    check('자막(ASS): 제목 · 낱말 강조 · 상자 · 특수문자 막기', /Style: Sub,Noto Sans CJK KR,72/.test(ass) && /Dialogue: 0,0:00:00\.00,0:00:03\.00,Title,,0,0,0,,제목/.test(ass)
      && ass.includes('{\\c&H00E6FF&}여러분{\\r} 이거') && ass.includes('SubBox') && !ass.includes('{실화}') && ass.split('\n').filter(l => l.includes(',Sub,')).length === 5, ass.slice(-700));
  }
  const r3_sid = a2_chosenId;
  await call('POST', '/api/shorts/script', { id: r3_sid, script: '여러분 이거 실화입니다. 회의 중에 팀장님이 갑자기 이런 말을 했어요. 여러분이라면 어떻게 하시겠어요?' }, sh_T0);
  check('일반 회원은 영상 만들기 403', (await call('POST', '/api/shorts/render', { scriptId: r3_sid }, T)).status === 403);
  const r3_v = await call('POST', '/api/shorts/voice', { voice: 'coral' }, sh_T0), r3_vn = ttsCalls.length;
  check('목소리 들어 보기 (WAV · gpt-4o-mini-tts · 말투 지시)', r3_v.status === 200 && r3_v.json.audio.startsWith('data:audio/wav;base64,UklGR') && ttsCalls.at(-1).body.voice === 'coral'
    && ttsCalls.at(-1).body.model === 'gpt-4o-mini-tts' && !!ttsCalls.at(-1).body.instructions && ttsCalls.at(-1).headers.authorization === 'Bearer sk-test-key', JSON.stringify(r3_v.json).slice(0, 100));
  await call('POST', '/api/shorts/voice', { voice: 'coral' }, sh_T0);
  check('같은 예문은 다시 만들지 않음 (비용 절약)', ttsCalls.length === r3_vn);
  if (HAS_FF) {
    const wait = async id => { for (let i = 0; i < 240; i++) { const r = (await call('GET', '/api/shorts/renders', null, sh_T0)).json.renders.find(x => x.id === id); if (!r || !['queued', 'running'].includes(r.status)) return r; await new Promise(z => setTimeout(z, 500)); } return null; };
    await call('POST', '/api/shorts/project', { scriptId: r3_sid, backgrounds: [] }, sh_T0);
    check('배경이 없으면 400', (await call('POST', '/api/shorts/render', { scriptId: r3_sid }, sh_T0)).status === 400);
    await call('POST', '/api/shorts/project', { scriptId: r3_sid, backgrounds: [a2_pxs.json.asset.id, a2_ui.json.asset.id] }, sh_T0);
    await call('POST', '/api/shorts/settings', { video: { clipSeconds: 2, voice: 'onyx', speed: 1.2, sub: { box: true } } }, sh_T0);
    ttsFail = 401;
    const r3_f = await call('POST', '/api/shorts/render', { scriptId: r3_sid }, sh_T0);
    const r3_fd = await wait(r3_f.json?.render?.id);
    check('음성 키 오류 → 실패 · 이유 표시', r3_f.status === 200 && r3_fd?.status === 'failed' && /API 키/.test(r3_fd.error), JSON.stringify(r3_fd));
    ttsFail = 0;
    const t0 = ttsCalls.length, used0 = (await call('GET', '/api/shorts', null, sh_T0)).json.storage.used;
    const r3 = await call('POST', '/api/shorts/render', { scriptId: r3_sid }, sh_T0);
    check('영상 만들기 → 대기열', r3.status === 200 && ['queued', 'running'].includes(r3.json.render.status), JSON.stringify(r3.json));
    const r3d = await wait(r3.json.render.id);
    check('영상 완성 (문장 3개 → 음성 3번 · 설정한 목소리)', r3d?.status === 'done' && r3d.progress === 100 && ttsCalls.length - t0 === 3 && ttsCalls.slice(t0).every(c => c.body.voice === 'onyx'), JSON.stringify(r3d));
    if (r3d?.status === 'done') {
      const dl = await fetch(`${BASE}${r3d.url}&dl=1`), file = path.join(TMP, 'out.mp4');
      fs.writeFileSync(file, Buffer.from(await dl.arrayBuffer()));
      check('내려받기 (영문 파일 이름)', dl.status === 200 && dl.headers.get('content-type') === 'video/mp4' && /^attachment; filename="shorts-\d{8}-\d{4}\.mp4"$/.test(dl.headers.get('content-disposition')), dl.headers.get('content-disposition'));
      const pr = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).stdout.toString() || '{}');
      const vs = (pr.streams || []).find(x => x.codec_type === 'video'), as = (pr.streams || []).find(x => x.codec_type === 'audio');
      const expect = (0.06 + 0.18 + 0.12) * 3 + 0.08 * '여러분이거실화입니다.회의중에팀장님이갑자기이런말을했어요.여러분이라면어떻게하시겠어요?'.length;   // 다듬은 음성 길이 (1.0배)
      check('1080×1920 · H.264 · 소리 · 길이(1.2배속 + 끝 여유)', vs?.width === 1080 && vs?.height === 1920 && vs?.codec_name === 'h264' && !!as && Math.abs(Number(pr.format.duration) - (expect / 1.2 + 0.8)) < 0.4 && Math.abs(r3d.duration - Number(pr.format.duration)) < 0.1, `${pr.format?.duration} vs ${expect / 1.2 + 0.8}`);
      check('완성 영상 미리보기 그림', (await fetch(BASE + r3d.thumb)).headers.get('content-type') === 'image/jpeg');
      check('저장 공간에 영상 크기 포함', (await call('GET', '/api/shorts', null, sh_T0)).json.storage.used >= used0 + r3d.size_bytes);
      check('다른 사람은 영상 지우기 못 함', (await call('POST', '/api/shorts/render/remove', { id: r3d.id }, T2b)).status !== 200);
      check('영상 지우기 → 파일도 지움', (await call('POST', '/api/shorts/render/remove', { id: r3d.id }, sh_T0)).status === 200 && (await fetch(BASE + r3d.url)).status === 404);
    }
  } else check('ffmpeg 없으면 503', (await call('POST', '/api/shorts/render', { scriptId: r3_sid }, sh_T0)).status === 503);

  if (HAS_FF) {
    const dm = await call('POST', '/api/shorts/demo', {}, sh_T0), dm2 = await call('POST', '/api/shorts/demo', {}, sh_T0);
    const dg = (await call('GET', '/api/shorts', null, sh_T0)).json, dp = dg.projects.find(x => x.script_id === dm2.json?.scriptId);
    check('예시로 채우기 (글 · 스크립트 2개 중 하나 고름 · 배경 3 · 음악 · 제작 준비, 다시 눌러도 소재는 그대로)', dm.status === 200 && dm2.status === 200
      && dg.assets.filter(x => x.source === 'demo').length === 4 && dg.scripts.filter(x => x.item_id === dm2.json.itemId).length === 2 && dg.scripts.find(x => x.id === dm2.json.scriptId)?.chosen
      && dp?.backgrounds.length === 3 && !!dp.music_id && dg.assets.find(x => x.id === dp.music_id)?.duration >= 39, JSON.stringify({ dm: dm.json, n: dg.assets.length }));
    check('일반 회원은 예시 403', (await call('POST', '/api/shorts/demo', {}, T)).status === 403);
  }

  console.log('목표 관리 › 상세 To do 추천 (AI)');
  {
    const gt = await call('POST', '/api/goals/todos', { area: 'P', start: '2026-10-06', end: '2026-12-05', level: 0, hours: 1, note: '평일 저녁만', goals: [{ name: '5km 달리기', cat: '건강 관리' }] }, T);
    const req = aiCalls.at(-1)?.body;
    check('회원도 AI To do 받기 (기간 안으로 날짜 맞춤 · 정렬)', gt.status === 200 && gt.json.goals[0].todos.length === 2 && gt.json.goals[0].todos[0].start === '2026-10-06' && gt.json.goals[0].todos[1].start === '2026-10-08'
      && gt.json.goals[0].todos[0].end === '2026-12-05' && gt.json.goals[0].milestones.at(-1).date === '2026-12-05' && gt.json.goals[0].todos[1].how === '매장에서 신어 보기', JSON.stringify(gt.json));
    check('AI 에게 기간 · 수준 · 메모 전달', req?.response_format.json_schema.name === 'goal_todos' && req.messages[1].content.includes('2026-10-06 ~ 2026-12-05') && req.messages[1].content.includes('평일 저녁만') && req.messages[1].content.includes('처음 시작함'));
    check('목표 안내(guide · tips) 전달', gt.json.goals[0].guide === '주간 거리를 천천히 늘리세요.' && JSON.stringify(gt.json.goals[0].tips) === '["무리하지 않기"]', JSON.stringify(gt.json.goals[0]));
    const gt2 = await call('POST', '/api/goals/todos', { area: 'P', start: '2026-10-06', end: '2026-12-05', goals: [{ name: '하프 마라톤', cat: '건강 관리', end: '2026-11-20', detail: '지금 10km 65분' }] }, T);
    const req2 = aiCalls.at(-1)?.body;
    check('목표마다 마감 · 목표 정보 전달, 날짜는 그 목표의 마감 안으로', gt2.status === 200 && req2.messages[1].content.includes('마감 2026-11-20') && req2.messages[1].content.includes('목표 정보: 지금 10km 65분')
      && gt2.json.goals[0].todos.every(t => t.end <= '2026-11-20') && gt2.json.goals[0].milestones.every(m => m.date <= '2026-11-20'), JSON.stringify(gt2.json));
    check('목표 없으면 400 · 로그인 안 하면 401', (await call('POST', '/api/goals/todos', { start: '2026-10-06', end: '2026-12-05', goals: [] }, T)).status === 400 && (await call('POST', '/api/goals/todos', { start: '2026-10-06', end: '2026-12-05', goals: [{ name: 'x' }] })).status === 401);
  }

  console.log('숏폼 4차 (유튜브 · 인스타그램 연결 · 업로드 · 성과)');
  {
    const uid4 = (await pool.query('SELECT id FROM jcal.users WHERE email = $1', [OWNER])).rows[0].id;
    const rid = (await pool.query("INSERT INTO jcal.shorts_renders (user_id, script_id, title, status, progress, size_bytes, duration) VALUES ($1, $2, '팀장님의 폭탄 발언', 'done', 100, 3000, 10) RETURNING id", [uid4, a2_chosenId])).rows[0].id;
    fs.mkdirSync(path.join(TMP, 'store', uid4, 'renders'), { recursive: true });
    fs.writeFileSync(path.join(TMP, 'store', uid4, 'renders', `${rid}.mp4`), Buffer.alloc(3000, 7));
    const s4 = (await call('GET', '/api/shorts', null, sh_T0)).json.social;
    check('업로드 준비: 키 있음 · 연결 안 됨 · 돌아오는 주소', s4?.channels.youtube.ready && !s4.channels.youtube.connected && s4.channels.instagram.ready && s4.callback.youtube === `${BASE}/api/oauth/youtube/callback`, JSON.stringify(s4).slice(0, 300));
    check('일반 회원은 연결 403', (await call('POST', '/api/shorts/social/connect', { platform: 'youtube' }, T)).status === 403);
    check('연결 전에는 올리기 400', (await call('POST', '/api/shorts/post', { renderId: rid, platforms: ['youtube'], title: 'x' }, sh_T0)).status === 400);
    const cu = new URL((await call('POST', '/api/shorts/social/connect', { platform: 'youtube' }, sh_T0)).json.url), st = cu.searchParams.get('state');
    check('유튜브 연결 주소 (오프라인 · 업로드 권한 · 돌아오는 주소)', cu.href.startsWith(`${F}/google/auth`) && cu.searchParams.get('access_type') === 'offline' && cu.searchParams.get('scope').includes('youtube.upload') && cu.searchParams.get('redirect_uri') === `${BASE}/api/oauth/youtube/callback` && !!st, cu.href);
    check('state 가 틀리면 400', (await fetch(`${BASE}/api/oauth/youtube/callback?code=good&state=${encodeURIComponent(`${st}x`)}`)).status === 400);
    check('다른 플랫폼의 state 는 거절', (await fetch(`${BASE}/api/oauth/instagram/callback?code=good&state=${encodeURIComponent(st)}`)).status === 400);
    check('허용 안 함 → 안내', (await (await fetch(`${BASE}/api/oauth/youtube/callback?error=access_denied&state=${encodeURIComponent(st)}`)).text()).includes('허용을 누르지 않아'));
    const cb = await fetch(`${BASE}/api/oauth/youtube/callback?code=good&state=${encodeURIComponent(st)}`), cbt = await cb.text();
    check('유튜브 연결 완료 (앱에 알리고 창 닫기)', cb.status === 200 && cbt.includes('내 채널') && cbt.includes('postMessage') && cbt.includes(ORIGIN), cbt.slice(0, 300));
    const tk = (await pool.query("SELECT access_token, refresh_token FROM jcal.shorts_channels WHERE user_id = $1 AND platform = 'youtube'", [uid4])).rows[0];
    check('토큰은 암호화해서 저장', tk && !tk.access_token.includes('g-acc') && !tk.refresh_token.includes('g-ref') && tk.access_token.length > 20);
    const iu = new URL((await call('POST', '/api/shorts/social/connect', { platform: 'instagram' }, sh_T0)).json.url);
    check('인스타그램 연결 주소 (게시 · 인사이트 권한)', iu.href.startsWith(`${F}/ig/oauth/authorize`) && iu.searchParams.get('scope').includes('instagram_business_content_publish') && iu.searchParams.get('scope').includes('manage_insights'), iu.href);
    const icb = await fetch(`${BASE}/api/oauth/instagram/callback?code=good%23_&state=${encodeURIComponent(iu.searchParams.get('state'))}`);
    const s5 = (await call('GET', '/api/shorts/social', null, sh_T0)).json;
    check('인스타그램 연결 완료 (@계정 · 60일 토큰)', icb.status === 200 && s5.social.channels.instagram.connected && s5.social.channels.instagram.name === '@my_ig' && new Date(s5.social.channels.instagram.expiresAt) > Date.now() + 50 * 86400000 && s5.social.channels.youtube.name === '내 채널', JSON.stringify(s5.social.channels));
    check('유튜브 제목에 < > 는 400', (await call('POST', '/api/shorts/post', { renderId: rid, platforms: ['youtube'], title: '제목 <x>' }, sh_T0)).status === 400);
    const p4 = await call('POST', '/api/shorts/post', { renderId: rid, platforms: ['youtube', 'instagram'], title: '팀장님의 폭탄 발언', caption: '회의 중 생긴 일 #회사 #썰', privacy: 'unlisted' }, sh_T0);
    check('두 곳에 올리기 → 2건', p4.status === 200 && p4.json.posts.length === 2, JSON.stringify(p4.json).slice(0, 200));
    const waitPosts = async ids => { for (let i = 0; i < 100; i++) { const ps = (await call('GET', '/api/shorts/social', null, sh_T0)).json.social.posts.filter(p => ids.includes(p.id)); if (ps.every(p => p.status === 'done' || p.status === 'failed')) return ps; await new Promise(z => setTimeout(z, 200)); } return []; };
    const done = await waitPosts(p4.json.posts.map(p => p.id)), yt = done.find(p => p.platform === 'youtube'), ig = done.find(p => p.platform === 'instagram');
    check('유튜브 업로드 (토큰 새로 받기 · 제목 · #Shorts · 태그 · 일부 공개 · 파일 전체)', yt?.status === 'done' && yt.url === 'https://www.youtube.com/shorts/yt-vid-1' && soc.gToken.some(t => t.grant_type === 'refresh_token') && soc.ytAuth === 'Bearer g-acc-2'
      && soc.ytMeta.snippet.title === '팀장님의 폭탄 발언' && soc.ytMeta.snippet.description.includes('#Shorts') && soc.ytMeta.snippet.tags.join() === '회사,썰' && soc.ytMeta.status.privacyStatus === 'unlisted' && soc.ytBytes === 3000, JSON.stringify({ yt, meta: soc.ytMeta, bytes: soc.ytBytes }));
    check('인스타그램 릴스 (영상 주소를 인스타가 직접 받음 · 캡션 · 링크)', ig?.status === 'done' && ig.url === 'https://www.instagram.com/reel/abc/' && soc.igMedia.media_type === 'REELS' && soc.igMedia.caption === '회의 중 생긴 일 #회사 #썰' && soc.igMedia.access_token === 'ig-long'
      && soc.igFetch?.status === 200 && soc.igFetch.bytes === 3000, JSON.stringify({ ig, m: soc.igMedia, f: soc.igFetch }));
    const s6 = await call('POST', '/api/shorts/stats', {}, sh_T0), ps6 = s6.json.social.posts;
    check('성과 가져오기 (유튜브 조회 · 인스타 조회 · 저장 · 공유)', s6.status === 200 && ps6.find(p => p.platform === 'youtube').stats.views === 1234 && ps6.find(p => p.platform === 'youtube').stats.likes === 56
      && ps6.find(p => p.platform === 'instagram').stats.views === 500 && ps6.find(p => p.platform === 'instagram').stats.saves === 4 && !!ps6[0].stats_at, JSON.stringify(ps6.map(p => p.stats)));
    soc.ytQuota = true;
    const pf = await call('POST', '/api/shorts/post', { renderId: rid, platforms: ['youtube'], title: '두 번째' }, sh_T0);
    const fd = (await waitPosts([pf.json.posts[0].id]))[0];
    check('유튜브 할당량 초과 → 실패 · 이유', fd?.status === 'failed' && /할당량/.test(fd.error), JSON.stringify(fd));
    soc.ytQuota = false;
    check('다시 시도 → 완료', (await call('POST', '/api/shorts/post/action', { id: fd.id, action: 'retry' }, sh_T0)).status === 200 && (await waitPosts([fd.id]))[0]?.status === 'done');
    const ps = await call('POST', '/api/shorts/post', { renderId: rid, platforms: ['instagram'], caption: '예약', scheduledAt: new Date(Date.now() + 2 * 3600000).toISOString() }, sh_T0);
    await new Promise(z => setTimeout(z, 500));
    check('예약 → 시간 전에는 안 올림', ps.status === 200 && (await call('GET', '/api/shorts/social', null, sh_T0)).json.social.posts.find(p => p.id === ps.json.posts[0].id).status === 'scheduled');
    check('예약 취소', (await call('POST', '/api/shorts/post/action', { id: ps.json.posts[0].id, action: 'cancel' }, sh_T0)).status === 200 && !(await call('GET', '/api/shorts/social', null, sh_T0)).json.social.posts.some(p => p.id === ps.json.posts[0].id));
    check('다른 사람 업로드는 404', (await call('POST', '/api/shorts/post/action', { id: yt.id, action: 'remove' }, T2b)).status !== 200);
    check('연결 끊기 (구글 허용도 취소)', (await call('POST', '/api/shorts/social/disconnect', { platform: 'youtube' }, sh_T0)).status === 200 && soc.revoked === 1 && !(await call('GET', '/api/shorts/social', null, sh_T0)).json.social.channels.youtube.connected);
  }

  await pool.query('DELETE FROM jcal.users WHERE email = $1', [OWNER]);
  await setS('signup_mode', 'closed');
  check('가입 막기 → 403', (await call('POST', '/api/signup', { email: `x${E2}`, password: 'pw-12345678', name: 'x', code: 'TEST-CODE' })).status === 403);
  await pool.query('DELETE FROM jcal.users WHERE email = $1', [E2]);
  await pool.query('DELETE FROM jcal.server_settings');
  for (const r of prevSet) await setS(r.key, r.value);

  console.log('로그아웃 · 실패 제한');
  check('로그아웃', (await call('POST', '/api/logout', null, T)).status === 200);
  check('로그아웃 뒤 토큰 무효', (await call('GET', '/api/me', null, T)).status === 401);
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/login', { email: EMAIL, password: 'nope' });
  check('10번 실패 뒤 429', last.status === 429);
} finally {
  srv.kill('SIGTERM'); fake.close(); fs.rmSync(TMP, { recursive: true, force: true });
  await pool.query('DELETE FROM jcal.users WHERE email = $1', [EMAIL]);
  await pool.end();
}
console.log(`\n결과: 통과 ${ok} · 실패 ${bad}`);
process.exitCode = bad ? 1 : 0;
