/* 기획 보드 › API로 가져오기
   - 주소(URL)에서 JSON 또는 CSV 를 읽어 기획 카드로 만든다 (브라우저에서 바로 호출)
   - JSON: 최상위 배열, 또는 data / items / results / records / value 같은 속성 안의 첫 배열을 목록으로 본다
           중첩 값은 "fields.Name" 처럼 점으로 이어 한 단계 더 펼친다 (Airtable·Notion 류 응답)
   - CSV: 첫 줄이 머리글 (구글 시트 "웹에 게시 → CSV" 주소 등)
   - 연결 설정은 store.plan.feeds = [{ id, name, url, header, token, map: { title, status, due, s1, s3, s6, link, key }, lastSync, count }]
   - 가져온 카드는 ext: { feed, key } 를 가져서 "다시 가져오기" 때 같은 항목을 찾아 갱신한다 */
import { parseCsv } from './categories/samsungHealth.js';
const PLAN_STATUS = ['아이디어', '초안', '검토', '확정', '보류'];      // PlanResearchView 와 같은 순서

export const MAP_FIELDS = [
  ['title', '제목 *'], ['status', '상태'], ['due', '마감'], ['s1', '1. 개요'], ['s3', '3. 안건 별 주요 내용'], ['s6', '6. 기타'], ['link', '링크'], ['key', '고유 ID (다시 가져오기용)'],
];

/** 한 항목을 { "a": 1, "b.c": 2 } 처럼 한 단계 펼친다 */
function flatten(o, pre = '', depth = 0, out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const key = pre ? `${pre}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flatten(v, key, depth + 1, out);
    else out[key] = Array.isArray(v) ? v.map(x => (typeof x === 'object' ? x?.name ?? x?.title ?? x?.plain_text ?? JSON.stringify(x) : x)).join(', ') : v;
  }
  return out;
}

/** 응답 본문 → 항목 배열 [{ 필드: 값 }] */
export function toRows(text) {
  const t = text.replace(/^﻿/, '').trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t);
    let list = Array.isArray(j) ? j : null;
    if (!list) for (const k of ['data', 'items', 'results', 'records', 'value', 'rows', 'issues', 'tasks', 'list']) if (Array.isArray(j[k])) { list = j[k]; break; }
    if (!list) list = Object.values(j).find(Array.isArray) || [j];
    return list.filter(x => x && typeof x === 'object').map(x => flatten(x));
  }
  const rows = parseCsv(t);
  const head = (rows[0] || []).map(h => String(h).trim());
  return rows.slice(1).filter(r => r.some(v => String(v).trim())).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** 주소에서 읽기. 실패하면 이유를 알기 쉬운 문장으로 */
export async function fetchRows(feed) {
  const headers = {};
  if (feed.token) headers[feed.header || 'Authorization'] = feed.token;
  let r;
  try { r = await fetch(feed.url, { headers }); } catch {
    throw new Error('주소에 연결하지 못했습니다. 인터넷 연결을 확인하고, 이 주소가 브라우저에서 읽기를 허용(CORS)하는지 확인하세요. 구글 시트는 "웹에 게시 → CSV" 주소를 쓰면 됩니다.');
  }
  if (!r.ok) throw new Error(`서버가 ${r.status} 응답을 보냈습니다${r.status === 401 || r.status === 403 ? ' (인증 토큰을 확인하세요)' : r.status === 404 ? ' (주소를 확인하세요)' : ''}`);
  const rows = toRows(await r.text());
  if (!rows.length) throw new Error('목록을 찾지 못했습니다. JSON 배열이나 머리글이 있는 CSV인지 확인하세요.');
  return rows;
}

/** 필드 이름으로 기본 연결 추측 */
export function guessMap(fields) {
  const find = re => fields.find(f => re.test(f)) || '';
  return {
    title: find(/(^|\.)(title|name|subject|summary|제목|이름|기획명|항목)$/i) || fields[0] || '',
    status: find(/(^|\.)(status|state|stage|상태|단계)$/i),
    due: find(/(^|\.)(due|due_?date|deadline|end|end_?date|마감|기한|종료)/i),
    s1: find(/(^|\.)(description|desc|overview|개요|설명|목적)$/i),
    s3: find(/(^|\.)(content|body|detail|details|notes?|내용|상세)$/i),
    s6: find(/(^|\.)(memo|etc|remark|기타|비고)$/i),
    link: find(/(^|\.)(url|link|html_url|web_?url|링크)$/i),
    key: find(/(^|\.)(id|key|uuid|번호|no)$/i),
  };
}

/** 외부 상태 값 → 아이디어 · 초안 · 검토 · 확정 · 보류 */
export function toStatus(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '아이디어';
  const direct = PLAN_STATUS.find(x => s.includes(x));
  if (direct) return direct;
  if (/hold|block|pause|대기|중단|보류/.test(s)) return '보류';
  if (/done|complete|closed|resolved|approved|finish|확정|완료|승인/.test(s)) return '확정';
  if (/review|검토|qa|check/.test(s)) return '검토';
  if (/progress|doing|draft|wip|작성|진행|초안/.test(s)) return '초안';
  return '아이디어';
}

/** 날짜 값 → YYYY-MM-DD (2026-10-05T.., 2026.10.5, 2026/10/05, 엑셀 숫자 제외) */
export function toDate(v) {
  const m = String(v ?? '').match(/(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

/** 가져오기 계획: 새로 추가 / 갱신(같은 ext key) / 건너뜀(제목 없음) */
export function planFeed(rows, feed, plans) {
  const M = feed.map || {};
  const get = (r, k) => (M[k] ? r[M[k]] ?? '' : '');
  const add = [], update = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const title = String(get(r, 'title')).trim();
    if (!title) { skipped++; return; }
    const key = String(get(r, 'key') || title || i);
    const link = String(get(r, 'link')).trim();
    const s6 = [String(get(r, 's6')).trim(), link && `링크: ${link}`].filter(Boolean).join('\n');
    const data = { title, status: toStatus(get(r, 'status')), due: toDate(get(r, 'due')), sec: { s1: String(get(r, 's1')).trim(), s3: String(get(r, 's3')).trim(), s6 } };
    const old = plans.find(p => p.ext?.feed === feed.id && p.ext?.key === key);
    if (old) update.push({ id: old.id, data }); else add.push({ key, data });
  });
  return { add, update, skipped };
}
