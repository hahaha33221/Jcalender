/* OneDrive 연동 (Microsoft Graph, 읽기 전용)
   - 서버 없이 브라우저에서 OAuth 2.0 인증 코드 + PKCE 로 로그인 (팝업 창)
   - 필요한 것: Azure 앱 등록의 "애플리케이션(클라이언트) ID" 1개 (docs/onedrive-integration.md)
   - 설정은 store.onedrive = { clientId, tenant, pins: [{id,name,path}] }
   - 토큰은 앱 데이터와 섞이지 않도록 별도 localStorage 키에 둔다 (백업·내보내기에 안 들어감) */
const TOKEN_KEY = 'jcalender.onedrive.token';
const PKCE_KEY = 'jcalender.onedrive.pkce';
export const SCOPES = 'offline_access User.Read Files.Read';
export const GRAPH = 'https://graph.microsoft.com/v1.0';
export const redirectUri = () => `${location.origin}${location.pathname}`;
const authBase = tenant => `https://login.microsoftonline.com/${tenant || 'common'}/oauth2/v2.0`;

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const writeJson = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장소를 못 쓰는 환경 */ } };
export const getToken = () => readJson(TOKEN_KEY);
export const signOut = () => writeJson(TOKEN_KEY, null);

/** 로그인 팝업에서 돌아온 창이면 부모 창에 코드를 넘기고 닫는다 (main.jsx 에서 앱보다 먼저 부름) */
export function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.get('state') || !(q.get('code') || q.get('error'))) return false;
  const msg = { type: 'onedrive-auth', code: q.get('code'), state: q.get('state'), error: q.get('error_description') || q.get('error') };
  if (window.opener) {
    window.opener.postMessage(msg, location.origin);
    window.close();
    return true;
  }
  history.replaceState(null, '', redirectUri() + location.hash);   // 팝업이 막혀 같은 창으로 돌아온 경우: 주소만 정리
  return false;
}

async function tokenRequest(cfg, body) {
  const r = await fetch(`${authBase(cfg.tenant)}/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, scope: SCOPES, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description?.split('\r\n')[0] || j.error || `토큰 요청 실패 (${r.status})`);
  const t = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  writeJson(TOKEN_KEY, t);
  return t;
}

/** 로그인: 팝업으로 Microsoft 로그인 → 코드 받기 → 토큰 교환 */
export async function signIn(cfg) {
  if (!cfg?.clientId) throw new Error('클라이언트 ID를 먼저 입력하세요');
  const verifier = rand(48), state = rand(16);
  writeJson(PKCE_KEY, { verifier, state });
  const url = `${authBase(cfg.tenant)}/authorize?${new URLSearchParams({
    client_id: cfg.clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
    scope: SCOPES, state, code_challenge: await sha256(verifier), code_challenge_method: 'S256', prompt: 'select_account',
  })}`;
  const win = window.open(url, 'onedrive-login', 'width=520,height=680');
  if (!win) throw new Error('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요');
  const msg = await new Promise((ok, no) => {
    const timer = setInterval(() => { if (win.closed) { clearInterval(timer); window.removeEventListener('message', on); no(new Error('로그인 창이 닫혔습니다')); } }, 500);
    const on = e => {
      if (e.origin !== location.origin || e.data?.type !== 'onedrive-auth') return;
      clearInterval(timer); window.removeEventListener('message', on); ok(e.data);
    };
    window.addEventListener('message', on);
  });
  const p = readJson(PKCE_KEY); writeJson(PKCE_KEY, null);
  if (msg.error) throw new Error(msg.error);
  if (!p || msg.state !== p.state) throw new Error('로그인 응답이 올바르지 않습니다 (state 불일치)');
  return tokenRequest(cfg, { grant_type: 'authorization_code', code: msg.code, redirect_uri: redirectUri(), code_verifier: p.verifier });
}

async function accessToken(cfg) {
  const t = getToken();
  if (!t) throw Object.assign(new Error('로그인이 필요합니다'), { auth: true });
  if (t.exp > Date.now()) return t.access;
  if (!t.refresh) { signOut(); throw Object.assign(new Error('로그인이 만료되었습니다'), { auth: true }); }
  try { return (await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: t.refresh })).access; }
  catch (e) { signOut(); throw Object.assign(new Error(`다시 로그인해 주세요 (${e.message})`), { auth: true }); }
}

/** Graph GET. path 는 '/me/drive/root/children' 처럼 */
export async function graph(cfg, path) {
  const r = await fetch(path.startsWith('http') ? path : GRAPH + path, { headers: { authorization: `Bearer ${await accessToken(cfg)}` } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { signOut(); throw Object.assign(new Error('로그인이 만료되었습니다'), { auth: true }); }
  if (!r.ok) throw new Error(j.error?.message || `OneDrive 요청 실패 (${r.status})`);
  return j;
}

const SEL = '$select=id,name,size,lastModifiedDateTime,webUrl,folder,file,parentReference,lastModifiedBy';
/** 폴더 안 항목 (다음 쪽까지 모두) */
export async function listChildren(cfg, id) {
  let url = `${id ? `/me/drive/items/${id}` : '/me/drive/root'}/children?${SEL}&$top=200`, out = [];
  for (let i = 0; url && i < 10; i++) { const j = await graph(cfg, url); out = out.concat(j.value || []); url = j['@odata.nextLink']; }
  return out.map(normalize);
}
export const searchDrive = async (cfg, q) => ((await graph(cfg, `/me/drive/root/search(q='${encodeURIComponent(q.replace(/'/g, "''"))}')?${SEL}&$top=100`)).value || []).map(normalize);
export const recentFiles = async cfg => ((await graph(cfg, '/me/drive/recent?$top=30')).value || []).map(x => normalize(x.remoteItem ? { ...x.remoteItem, id: x.id } : x));
export const driveInfo = cfg => graph(cfg, '/me/drive?$select=owner,quota,driveType');

/** 화면에서 쓰는 모양으로 정리 */
export function normalize(x) {
  const path = (x.parentReference?.path || '').replace(/^\/drive\/root:?/, '').replace(/^\//, '');
  return {
    id: x.id, name: x.name, folder: !!x.folder, count: x.folder?.childCount ?? null, size: x.size || 0,
    modified: x.lastModifiedDateTime || '', by: x.lastModifiedBy?.user?.displayName || '', url: x.webUrl || '',
    path: decodeURIComponent(path), ext: x.folder ? '' : (x.name.includes('.') ? x.name.split('.').pop().toLowerCase() : ''),
  };
}
