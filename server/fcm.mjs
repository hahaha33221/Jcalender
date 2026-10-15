/* 안드로이드 앱 서버 푸시 (Firebase Cloud Messaging HTTP v1)
   - 키: FCM_SERVICE_ACCOUNT = Firebase 서비스 계정 JSON 을 base64 로 (jcal-admin fcm-key 가 /etc/jcalender.env 에 넣음, 저장소에는 없음)
   - 서비스 계정으로 JWT(RS256)를 만들어 접근 토큰을 받고(1시간, 미리 갱신) messages:send 로 기기 하나씩 보낸다 (추가 패키지 없음)
   - 시험: FCM_BASE (messages:send 주소 앞부분) · 서비스 계정의 token_uri 를 가짜 서버로 바꿔 시험한다 (server/test.mjs) */
import crypto from 'crypto';

const env = process.env;
let acct = null, acctErr = '';
const load = () => {
  if (acct || acctErr || !env.FCM_SERVICE_ACCOUNT) return acct;
  try {
    const j = JSON.parse(Buffer.from(env.FCM_SERVICE_ACCOUNT, 'base64').toString('utf8'));
    if (!j.project_id || !j.client_email || !j.private_key) throw new Error('project_id · client_email · private_key 가 없습니다');
    acct = { project: j.project_id, email: j.client_email, key: j.private_key, tokenUri: j.token_uri || 'https://oauth2.googleapis.com/token' };
  } catch (e) { acctErr = e.message; console.error('[FCM] 서비스 계정 읽기 실패:', e.message); }
  return acct;
};
export const fcmReady = () => !!load();
export const fcmProject = () => load()?.project || '';

const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let tok = { v: '', exp: 0 };
async function accessToken() {
  const a = load(); if (!a) throw new Error('FCM 키가 없습니다');
  if (tok.v && Date.now() < tok.exp - 120e3) return tok.v;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: a.email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: a.tokenUri, iat: now, exp: now + 3600 }));
  const sig = b64u(crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(a.key));
  const r = await fetch(a.tokenUri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`FCM 인증 실패 (${r.status} ${j.error || ''})`);
  tok = { v: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tok.v;
}

/** 기기 하나에 보내기 → 'ok' | 'gone'(앱 지움 · 토큰 만료) | 'fail' */
export async function fcmSend(token, p) {
  const a = load(); if (!a) return 'fail';
  const message = {
    token,
    notification: { title: String(p.title || '').slice(0, 200), body: String(p.body || '').slice(0, 500) },
    data: { url: String(p.url || '/'), tag: String(p.tag || ''), alarm: p.alarm ? '1' : '0' },
    android: { priority: 'HIGH', ttl: '3600s', notification: {
      channel_id: p.alarm ? 'jcal-alarm' : 'jcal-normal', tag: String(p.tag || '').slice(0, 120) || undefined, icon: 'ic_stat_jcal', color: '#14212b',
      default_sound: true, default_vibrate_timings: true, notification_priority: p.alarm ? 'PRIORITY_MAX' : 'PRIORITY_HIGH', visibility: 'PUBLIC' } },
  };
  try {
    const r = await fetch(`${(env.FCM_BASE || 'https://fcm.googleapis.com').replace(/\/+$/, '')}/v1/projects/${a.project}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }), signal: AbortSignal.timeout(15000) });
    if (r.ok) return 'ok';
    const j = await r.json().catch(() => ({}));
    const code = j.error?.details?.find?.(d => d.errorCode)?.errorCode || j.error?.status || '';
    if (r.status === 404 || code === 'UNREGISTERED' || (r.status === 400 && /registration token/i.test(j.error?.message || ''))) return 'gone';
    if (r.status === 401) tok = { v: '', exp: 0 };
    console.error('[FCM]', r.status, code, j.error?.message || '');
    return 'fail';
  } catch (e) { console.error('[FCM]', e.message); return 'fail'; }
}
