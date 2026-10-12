/* 웹 푸시 (1단계: PWA) — 앱 · 브라우저가 꺼져 있어도 휴대폰 · PC 로 알림
   - 키: VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY (setup.sh 가 처음 한 번 만들어 /etc/jcalender.env 에 넣음, 사람이 넣을 것 없음)
   - 기기 등록: POST /api/push/subscribe { sub: { endpoint, keys: { p256dh, auth } }, device } → push_subs (같은 기기는 덮어씀)
   - 1분마다: 기기를 등록한 사용자마다 서버에 동기화된 데이터로 "지금 보낼 알림"을 계산(src/notify.js, 화면과 같은 규칙) → 등록 기기 전부에 보냄
     같은 알림은 push_sent 로 한 번만, 만료된 기기(404 · 410)는 지움, 시간은 한국 시간(TZ=Asia/Seoul)
   - 시험: PUSH_SEND_LOG=파일 이면 실제로 보내지 않고 암호화까지만 한 뒤 내용을 파일에 한 줄씩 적음 */
import fs from 'fs';
import webpush from 'web-push';
import { dueNotifications } from '../src/notify.js';

process.env.TZ = process.env.TZ || 'Asia/Seoul';                // 일정 · 루틴 시각은 한국 시간
const env = process.env;
const TICK = Number(env.PUSH_TICK_MS || 60000);
const ready = () => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
let vapidSet = false;
const vapid = owner => {
  if (!vapidSet && ready()) { webpush.setVapidDetails(env.VAPID_SUBJECT || `mailto:${owner || 'admin@example.com'}`, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY); vapidSet = true; }
  return vapidSet;
};
const cleanDevice = s => String(s || '').replace(/[\u0000-\u001f]/g, '').slice(0, 100);
const okSub = s => s && typeof s.endpoint === 'string' && /^https:\/\/[^\s]{10,1000}$/.test(s.endpoint) && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string'
  && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;

export function pushModule({ pool, authUser, HttpError, owner }) {
  /** 기기 하나에 보내기 → 'ok' | 'gone'(지움) | 'fail' */
  const sendOne = async (row, payload) => {
    const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    const body = JSON.stringify(payload);
    try {
      if (env.PUSH_SEND_LOG) {                                  // 시험: 암호화까지 해 보고 기록만
        webpush.generateRequestDetails(sub, body, { TTL: 3600 });
        fs.appendFileSync(env.PUSH_SEND_LOG, `${JSON.stringify({ endpoint: row.endpoint, ...payload })}\n`);
      } else await webpush.sendNotification(sub, body, { TTL: 3600, urgency: 'high' });
      await pool.query('UPDATE jcal.push_subs SET last_ok = now(), fails = 0 WHERE id = $1', [row.id]);
      return 'ok';
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await pool.query('DELETE FROM jcal.push_subs WHERE id = $1', [row.id]); return 'gone'; }
      console.error('[푸시]', e.statusCode || '', e.body || e.message);
      await pool.query('UPDATE jcal.push_subs SET fails = fails + 1 WHERE id = $1', [row.id]);
      await pool.query('DELETE FROM jcal.push_subs WHERE id = $1 AND fails >= 20', [row.id]);   // 계속 실패하는 기기는 정리
      return 'fail';
    }
  };
  const sendUser = async (userId, payload) => {
    const { rows } = await pool.query('SELECT * FROM jcal.push_subs WHERE user_id = $1', [userId]);
    const res = [];
    for (const r of rows) res.push(await sendOne(r, payload));
    return res;
  };

  /** 1분마다: 보낼 알림 계산 → 보내기 */
  let running = false;
  const tick = async (now = new Date()) => {
    if (running || !vapid(owner)) return 0;
    running = true;
    let n = 0;
    try {
      const { rows } = await pool.query(`SELECT s.user_id, s.data FROM jcal.store_snapshots s
        WHERE s.user_id IN (SELECT DISTINCT user_id FROM jcal.push_subs)`);
      for (const r of rows) {
        let due = [];
        try { due = dueNotifications({ ...r.data, notifications: [] }, now); } catch (e) { console.error('[푸시] 계산', e.message); continue; }
        for (const d of due.slice(0, 10)) {
          const ins = await pool.query('INSERT INTO jcal.push_sent (user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key', [r.user_id, String(d.key).slice(0, 200)]);
          if (!ins.rowCount) continue;                           // 이미 보냄
          await sendUser(r.user_id, { title: d.title, body: d.body || '', tag: String(d.key).slice(0, 120), url: d.url || '/' });
          n++;
        }
      }
      await pool.query("DELETE FROM jcal.push_sent WHERE sent_at < now() - interval '14 days'");
    } catch (e) { console.error('[푸시] 확인 실패', e.message); }
    finally { running = false; }
    return n;
  };
  const start = () => { if (TICK > 0) setInterval(() => { tick(); }, TICK).unref(); };

  const routes = {
    'GET /api/push/config': async req => {
      await authUser(req);
      return { ready: ready(), publicKey: ready() ? env.VAPID_PUBLIC_KEY : '' };
    },
    'GET /api/push/devices': async req => {
      const u = await authUser(req);
      const { rows } = await pool.query('SELECT endpoint, device, created_at, last_ok FROM jcal.push_subs WHERE user_id = $1 ORDER BY created_at', [u.id]);
      return { ready: ready(), devices: rows.map(r => ({ id: r.endpoint.slice(-16), endpoint: r.endpoint, device: r.device, createdAt: r.created_at, lastOk: r.last_ok })) };
    },
    'POST /api/push/subscribe': async (req, body) => {
      const u = await authUser(req);
      if (!ready()) throw new HttpError(503, '서버에 푸시 키가 아직 없습니다. VPS 에서 업데이트(update.sh)를 실행해 주세요');
      if (!okSub(body.sub)) throw new HttpError(400, '푸시 구독 정보가 올바르지 않습니다');
      const { rows: [c] } = await pool.query('SELECT count(*)::int n FROM jcal.push_subs WHERE user_id = $1', [u.id]);
      if (c.n >= 20) await pool.query('DELETE FROM jcal.push_subs WHERE id = (SELECT id FROM jcal.push_subs WHERE user_id = $1 ORDER BY created_at LIMIT 1)', [u.id]);
      await pool.query(`INSERT INTO jcal.push_subs (user_id, endpoint, p256dh, auth, device) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device = EXCLUDED.device, fails = 0`,
      [u.id, body.sub.endpoint, body.sub.keys.p256dh, body.sub.keys.auth, cleanDevice(body.device)]);
      return { ok: true };
    },
    'POST /api/push/unsubscribe': async (req, body) => {
      const u = await authUser(req);
      await pool.query('DELETE FROM jcal.push_subs WHERE user_id = $1 AND endpoint = $2', [u.id, String(body.endpoint || '')]);
      return { ok: true };
    },
    'POST /api/push/test': async (req, body) => {
      const u = await authUser(req);
      if (!vapid(owner)) throw new HttpError(503, '서버에 푸시 키가 아직 없습니다. VPS 에서 업데이트(update.sh)를 실행해 주세요');
      const one = body.endpoint ? String(body.endpoint) : '';
      const { rows } = await pool.query(`SELECT * FROM jcal.push_subs WHERE user_id = $1${one ? ' AND endpoint = $2' : ''}`, one ? [u.id, one] : [u.id]);
      if (!rows.length) throw new HttpError(404, '푸시를 받을 기기가 없습니다. 먼저 "이 기기에서 푸시 받기"를 눌러 주세요');
      const res = [];
      for (const r of rows) res.push(await sendOne(r, { title: 'Jcalender 시험 알림', body: '푸시 알림이 잘 옵니다. 앱을 닫아도 이렇게 알려 드려요', tag: `test:${Date.now()}`, url: '/#/settings' }));
      return { sent: res.filter(x => x === 'ok').length, total: rows.length };
    },
  };
  return { routes, start, tick };
}
