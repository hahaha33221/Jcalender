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
const aiCalls = [];
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
  if (req.url === '/v1/chat/completions') {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      aiCalls.push({ url: req.url, headers: req.headers, body: JSON.parse(b) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
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
  PEXELS_API_KEY: 'test-pexels-key', PEXELS_BASE_URL: `${F}/pexels`, SHORTS_DIR: path.join(TMP, 'store'), SHORTS_MAX_UPLOAD_MB: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
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

  console.log(`숏폼 2차 (소재함 · Pexels · 제작 준비)${HAS_FF ? '' : ' — ffmpeg 없음: 길이 · 미리보기 확인은 건너뜀'}`);
  const a2_up = async (file, name, type, token = sh_T0) => { const r = await fetch(`${BASE}/api/shorts/upload`, { method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }, body: fs.readFileSync(file) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const a2_uv = await a2_up(VID, '사무실 영상.mp4', 'video/mp4');
  check('영상 올리기', a2_uv.status === 200 && a2_uv.json.asset.kind === 'video' && a2_uv.json.asset.name === '사무실 영상', JSON.stringify(a2_uv.json).slice(0, 200));
  if (HAS_FF) check('영상 크기 · 길이 · 미리보기 (세로 360×640, 2초)', a2_uv.json.asset.width === 360 && a2_uv.json.asset.height === 640 && Math.abs(a2_uv.json.asset.duration - 2) < 0.3 && !!a2_uv.json.asset.thumb, JSON.stringify(a2_uv.json.asset));
  const a2_ui = await a2_up(IMG, 'desk.jpg', 'image/jpeg'), a2_um = await a2_up(MP3, '잔잔한 음악.mp3', 'audio/mpeg');
  check('이미지 · 음악 올리기', a2_ui.json?.asset.kind === 'image' && a2_um.json?.asset.kind === 'music' && (!HAS_FF || Math.abs(a2_um.json.asset.duration - 3) < 0.3), JSON.stringify(a2_um.json));
  check('지원 안 하는 파일 415', (await a2_up(IMG, 'memo.txt', 'text/plain')).status === 415);
  const a2_big = path.join(TMP, 'a2_big.mp4'); fs.writeFileSync(a2_big, Buffer.alloc(1.5 * 1024 * 1024));
  check('너무 큰 파일 413 (1MB 제한)', (await a2_up(a2_big, 'a2_big.mp4', 'video/mp4')).status === 413);
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
