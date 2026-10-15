/* 웹 푸시 (1단계: PWA) — 앱 · 브라우저가 꺼져 있어도 휴대폰 · PC 로 알림
   - 키: VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY (setup.sh 가 처음 한 번 만들어 /etc/jcalender.env 에 넣음, 사람이 넣을 것 없음)
   - 기기 등록: POST /api/push/subscribe { sub: { endpoint, keys: { p256dh, auth } }, device } → push_subs (같은 기기는 덮어씀)
   - 1분마다: 기기를 등록한 사용자마다 서버에 동기화된 데이터로 "지금 보낼 알림"을 계산(src/notify.js, 화면과 같은 규칙) → 등록 기기 전부에 보냄
     같은 알림은 push_sent 로 한 번만, 만료된 기기(404 · 410)는 지움, 시간은 한국 시간(TZ=Asia/Seoul)
   - 시험: PUSH_SEND_LOG=파일 이면 실제로 보내지 않고 암호화까지만 한 뒤 내용을 파일에 한 줄씩 적음
   - 안드로이드 앱(FCM, server/fcm.mjs): 앱이 기기 토큰을 등록(POST /api/push/fcm/register) → 같은 알림을 FCM 으로도 보낸다
     앱은 앞으로 7일 알람을 기기에 직접 예약해 두므로, 그 목록(제목|시각)을 서버에 알려 주면(POST /api/push/fcm/scheduled) 그 알람은 FCM 으로 다시 보내지 않는다 (두 번 울림 방지)
     → 다른 기기(맥 · 웹)에서 새로 만들거나 바꾼 일정 · 루틴만 서버가 보냄 */
import fs from 'fs';
import webpush from 'web-push';
import { dueNotifications } from '../src/notify.js';
import { fcmReady, fcmSend } from './fcm.mjs';

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
const okFcm = t => typeof t === 'string' && /^[\w:.-]{20,4096}$/.test(t);
/** 알람 서명: 제목 | 울릴 시각(ms) — 앱이 예약한 알람과 서버가 보낼 알림을 맞춰 보는 데 씀 (src/native.js 와 같게) */
export const alarmSig = (title, when) => `${String(title).slice(0, 150)}|${+new Date(when)}`;
const okSub = s => s && typeof s.endpoint === 'string' && /^https:\/\/[^\s]{10,1000}$/.test(s.endpoint) && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string'
  && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;

export function pushModule({ pool, authUser, HttpError, owner }) {
  /** 기기 하나에 보내기 → 'ok' | 'gone'(지움) | 'fail' */
  const sendOne = async (row, payload) => {
    if (!vapidSet) return 'fail';
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
  /** 안드로이드 앱 하나에 (FCM) */
  const sendFcm = async (row, payload) => {
    const r = await fcmSend(row.token, payload);
    if (r === 'ok') await pool.query('UPDATE jcal.fcm_tokens SET last_ok = now(), fails = 0 WHERE id = $1', [row.id]);
    else if (r === 'gone') await pool.query('DELETE FROM jcal.fcm_tokens WHERE id = $1', [row.id]);
    else { await pool.query('UPDATE jcal.fcm_tokens SET fails = fails + 1 WHERE id = $1', [row.id]); await pool.query('DELETE FROM jcal.fcm_tokens WHERE id = $1 AND fails >= 20', [row.id]); }
    return r;
  };
  /** 사용자의 모든 기기에: 웹 푸시 + 안드로이드 앱(FCM, 그 앱이 이미 예약해 둔 알람이면 건너뜀) */
  const sendUser = async (userId, payload, sig = '') => {
    const { rows } = await pool.query('SELECT * FROM jcal.push_subs WHERE user_id = $1', [userId]);
    const res = [];
    for (const r of rows) res.push(await sendOne(r, payload));
    if (fcmReady()) {
      const { rows: fs2 } = await pool.query('SELECT * FROM jcal.fcm_tokens WHERE user_id = $1', [userId]);
      for (const r of fs2) { if (sig && Array.isArray(r.scheduled) && r.scheduled.includes(sig)) { res.push('local'); continue; } res.push(await sendFcm(r, payload)); }
    }
    return res;
  };

  /** 1분마다: 보낼 알림 계산 → 보내기 */
  let running = false;
  const tick = async (now = new Date()) => {
    vapid(owner);
    if (running || (!vapidSet && !fcmReady())) return 0;
    running = true;
    let n = 0;
    try {
      const { rows } = await pool.query(`SELECT s.user_id, s.data FROM jcal.store_snapshots s
        WHERE s.user_id IN (SELECT user_id FROM jcal.push_subs UNION SELECT user_id FROM jcal.fcm_tokens)`);
      for (const r of rows) {
        let due = [];
        try { due = dueNotifications({ ...r.data, notifications: [] }, now); } catch (e) { console.error('[푸시] 계산', e.message); continue; }
        for (const d of due.slice(0, 10)) {
          const ins = await pool.query('INSERT INTO jcal.push_sent (user_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING key', [r.user_id, String(d.key).slice(0, 200)]);
          if (!ins.rowCount) continue;                           // 이미 보냄
          await sendUser(r.user_id, { title: d.title, body: d.body || '', tag: String(d.key).slice(0, 120), url: d.url || '/', alarm: !!d.alarm }, d.when ? alarmSig(d.title, d.when) : '');   // alarm: 루틴 알람 (긴 진동 · 누를 때까지 표시)
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
    /** 안드로이드 앱: 서버 푸시 상태 · 이 계정의 앱 기기 */
    'GET /api/push/fcm': async req => {
      const u = await authUser(req);
      const { rows } = await pool.query('SELECT token, device, created_at, last_ok, jsonb_array_length(scheduled) AS n FROM jcal.fcm_tokens WHERE user_id = $1 ORDER BY created_at', [u.id]);
      return { ready: fcmReady(), devices: rows.map(r => ({ id: r.token.slice(-12), device: r.device, createdAt: r.created_at, lastOk: r.last_ok, scheduled: r.n })) };
    },
    'POST /api/push/fcm/register': async (req, body) => {
      const u = await authUser(req);
      if (!okFcm(body.token)) throw new HttpError(400, '앱 푸시 토큰이 올바르지 않습니다');
      const { rows: [c] } = await pool.query('SELECT count(*)::int n FROM jcal.fcm_tokens WHERE user_id = $1', [u.id]);
      if (c.n >= 10) await pool.query('DELETE FROM jcal.fcm_tokens WHERE id = (SELECT id FROM jcal.fcm_tokens WHERE user_id = $1 ORDER BY created_at LIMIT 1)', [u.id]);
      await pool.query(`INSERT INTO jcal.fcm_tokens (user_id, token, device) VALUES ($1, $2, $3)
        ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, device = EXCLUDED.device, fails = 0`, [u.id, body.token, cleanDevice(body.device)]);
      return { ok: true, ready: fcmReady() };
    },
    'POST /api/push/fcm/unregister': async (req, body) => {
      const u = await authUser(req);
      await pool.query('DELETE FROM jcal.fcm_tokens WHERE user_id = $1 AND token = $2', [u.id, String(body.token || '')]);
      return { ok: true };
    },
    /** 앱이 기기에 직접 예약한 알람 목록 (제목|시각) → 그 알람은 FCM 으로 다시 보내지 않음 */
    'POST /api/push/fcm/scheduled': async (req, body) => {
      const u = await authUser(req);
      const sigs = (Array.isArray(body.sigs) ? body.sigs : []).filter(x => typeof x === 'string' && x.length <= 220).slice(0, 100);
      const r = await pool.query('UPDATE jcal.fcm_tokens SET scheduled = $3 WHERE user_id = $1 AND token = $2', [u.id, String(body.token || ''), JSON.stringify(sigs)]);
      if (!r.rowCount) throw new HttpError(404, '등록되지 않은 앱입니다');
      return { ok: true, n: sigs.length };
    },
    'POST /api/push/test': async (req, body) => {
      const u = await authUser(req);
      if (body.fcm) {                                            // 안드로이드 앱 하나에 시험 (FCM)
        if (!fcmReady()) throw new HttpError(503, '서버에 앱 푸시(FCM) 키가 아직 없습니다. 맥북에서 fcm-key.sh 로 넣어 주세요');
        const { rows } = await pool.query('SELECT * FROM jcal.fcm_tokens WHERE user_id = $1 AND token = $2', [u.id, String(body.fcm)]);
        if (!rows.length) throw new HttpError(404, '이 앱이 아직 서버에 등록되지 않았습니다');
        const r = await sendFcm(rows[0], { title: 'Jcalender 서버 푸시 시험', body: '다른 기기에서 바꾼 일정도 이렇게 바로 옵니다', tag: `test:${Date.now()}`, url: '/#/alarms', alarm: true });
        if (r !== 'ok') throw new HttpError(502, r === 'gone' ? '이 앱의 푸시 토큰이 만료됐습니다. 앱을 다시 열어 주세요' : '앱 푸시를 보내지 못했습니다 (서버 기록 확인)');
        return { sent: 1, total: 1 };
      }
      if (!vapid(owner)) throw new HttpError(503, '서버에 푸시 키가 아직 없습니다. VPS 에서 업데이트(update.sh)를 실행해 주세요');
      const one = body.endpoint ? String(body.endpoint) : '';
      const { rows } = await pool.query(`SELECT * FROM jcal.push_subs WHERE user_id = $1${one ? ' AND endpoint = $2' : ''}`, one ? [u.id, one] : [u.id]);
      if (!rows.length) throw new HttpError(404, '푸시를 받을 기기가 없습니다. 먼저 "이 기기에서 푸시 받기"를 눌러 주세요');
      const res = [];
      for (const r of rows) res.push(await sendOne(r, { title: 'Jcalender 시험 알림', body: '푸시 알림이 잘 옵니다. 루틴 알람은 이렇게 길게 진동하고, 누를 때까지 남아 있어요', tag: `test:${Date.now()}`, url: '/#/settings', alarm: true }));
      return { sent: res.filter(x => x === 'ok').length, total: rows.length };
    },
  };
  return { routes, start, tick };
}
