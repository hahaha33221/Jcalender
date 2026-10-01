/* API 서버 점검: 빈 DB 에 서버를 띄우고 로그인 · 동기화 · 충돌 · 화면 주소 제한을 확인한다
   DATABASE_URL=postgres://… [FIXTURE=백업.json] node test.mjs */
import { spawn } from 'child_process';
import fs from 'fs';
import { pool } from './db.mjs';
import { hashPassword } from './auth.mjs';

const PORT = 18787, BASE = `http://127.0.0.1:${PORT}`, ORIGIN = 'https://jcalender-test.vercel.app';
const EMAIL = `test-${Date.now()}@example.com`, PW = 'test-password-1';
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
const srv = spawn(process.execPath, ['index.mjs'], { env: { ...process.env, PORT: String(PORT), ALLOWED_ORIGINS: 'https://*.vercel.app' }, stdio: ['ignore', 'pipe', 'inherit'] });
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

  console.log('로그아웃 · 실패 제한');
  check('로그아웃', (await call('POST', '/api/logout', null, T)).status === 200);
  check('로그아웃 뒤 토큰 무효', (await call('GET', '/api/me', null, T)).status === 401);
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/login', { email: EMAIL, password: 'nope' });
  check('10번 실패 뒤 429', last.status === 429);
} finally {
  srv.kill('SIGTERM');
  await pool.query('DELETE FROM jcal.users WHERE email = $1', [EMAIL]);
  await pool.end();
}
console.log(`\n결과: 통과 ${ok} · 실패 ${bad}`);
process.exitCode = bad ? 1 : 0;
