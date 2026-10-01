import { iso } from './data.js';

/* 기념일: { id, name, person(관련 인물, 자유 입력), date: 'YYYY-MM-DD'(처음 날짜), kind: '생일' | '기념일', yearly: 매년 반복 여부,
             lunar: 음력 날짜인지(date 의 월·일이 음력), leap: 음력 윤달, noYear: 연도를 모름(date 의 연도는 2000 으로 두고 주년을 세지 않음) } */
export const ANNIV_KINDS = ['생일', '기념일'];

/** 기본 기념일 (2026-09-30 받은 엑셀 기준) */
export const seedAnniv = () => [];                 // 사용자마다 직접 입력 (개인 기념일은 코드에 두지 않음)
/** 예전 저장 구조 표시만 올린다 (기념일 목록은 그대로) */
export const replaceAnnivOnce = s => (s.annivV2 ? s : { ...s, annivV2: true });

/* ── 음력 → 양력 (브라우저 내장 한국 음력 달력 Intl 'dangi' 사용) ── */
let dangi = null;
try { dangi = new Intl.DateTimeFormat('ko-KR-u-ca-dangi', { year: 'numeric', month: 'numeric', day: 'numeric' }); } catch { dangi = null; }
const lunarCache = new Map();
const lunarOf = d => {
  const parts = dangi.formatToParts(d);
  const get = t => parts.find(p => p.type === t)?.value || '';
  return { y: Number(get('relatedYear') || get('year')), m: get('month'), d: Number(get('day')) };
};
/** 음력 y년 m월 d일(윤달이면 leap) → 양력 Date. 그 달에 30일이 없으면 29일로 */
export function lunarToSolar(y, m, d, leap = false) {
  const key = `${y}-${m}-${d}-${leap ? 1 : 0}`;
  if (lunarCache.has(key)) return lunarCache.get(key);
  let out = null;
  if (dangi) {
    const want = `${leap ? '윤' : ''}${m}`;
    let fallback = null;
    for (let t = new Date(y, 0, 15); t < new Date(y + 1, 2, 1); t.setDate(t.getDate() + 1)) {
      const l = lunarOf(t);
      if (l.y !== y || l.m !== want) continue;
      if (l.d === d) { out = new Date(t); break; }
      if (l.d === d - 1) fallback = new Date(t);
    }
    if (!out && d === 30) out = fallback;
  }
  lunarCache.set(key, out);
  return out;
}
/** 기념일의 y년(양력 기준 반복 연도) 날짜 */
function dateIn(a, y) {
  const [, m, d] = a.date.split('-').map(Number);
  if (!a.lunar) return new Date(y, m - 1, d);
  return lunarToSolar(y, m, d, a.leap);
}
/** 음력 기념일이면 " (음력 10/1)" */
export const lunarTag = a => (a.lunar ? ` (음력 ${a.leap ? '윤' : ''}${Number(a.date.slice(5, 7))}/${Number(a.date.slice(8, 10))})` : '');
/** 표시용 날짜 글자: 양력 10월 3일 / 음력 10월 1일 / 1990년 음력 10월 1일 */
export const annivDateText = a => {
  const [y, m, d] = a.date.split('-').map(Number);
  return `${a.noYear ? '' : `${y}년 `}${a.lunar ? `음력 ${a.leap ? '윤' : ''}` : ''}${m}월 ${d}일`;
};

const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** today 이후(당일 포함) 가장 가까운 날짜와 D-day. 지난 1회성 기념일은 null */
export function nextAnniv(a, today) {
  const y = Number(a.date.slice(0, 4));
  const t = day0(today);
  let next = null, ry = y;
  if (a.yearly) {
    // 음력은 해를 넘겨 양력 1~2월에 올 수 있어 전년도부터 본다
    for (const cy of [t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1, t.getFullYear() + 2]) {
      const c = dateIn(a, cy);
      if (c && c >= t) { next = c; ry = cy; break; }
    }
  } else next = dateIn(a, y);
  if (!next || next < t) return null;
  const dday = Math.round((next - t) / 864e5);
  const years = a.yearly && !a.noYear ? ry - y : 0;
  return { date: next, key: iso(next), dday, years };
}

/** 날짜(YYYY-MM-DD)별 기념일 목록 (캘린더 표시용) */
export function annivOn(list, key) {
  const [ky, m, d] = key.split('-');
  return list.filter(a => {
    if (!a.lunar) return a.yearly ? a.date.slice(5) === `${m}-${d}` : a.date === key;
    const ys = a.yearly ? [Number(ky) - 1, Number(ky)] : [Number(a.date.slice(0, 4))];
    return ys.some(y => { const c = dateIn(a, y); return c && iso(c) === key; });
  });
}

/* ── 엑셀 양식 · 업로드 ──
   열: 이름 | 관련 인물 | 날짜 | 종류(생일/기념일) | 매년 반복(O/X) | 양력/음력
   열은 머리글 이름으로 찾으므로 예전 양식(관련 인물 없음)이나 "양력/음력 · 날짜 · 내용" 표도 올릴 수 있다
   날짜는 연도 없이 "10월 1일"도 된다 (주년은 세지 않음). 음력 윤달은 "윤6월 1일" 
   이름이 "(예시)" 로 끝나는 줄은 건너뛴다 */
export const ANNIV_HEAD = ['이름', '관련 인물', '날짜 (YYYY-MM-DD)', '종류 (생일/기념일)', '매년 반복 (O/X)', '양력/음력'];

/** 날짜 칸 → 'YYYY-MM-DD' (엑셀 날짜 숫자, 2024-3-5, 2024.03.05, 2024/3/5, 20240305) */
export function normDate(v, excelDate) {
  if (typeof v === 'number') return v > 19000000 ? normDate(String(v)) : excelDate(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 표 → { items, skipped: [{ row, why }] } */
export function parseAnnivRows(rows, excelDate) {
  const items = [], skipped = [];
  const isName = v => /^(이름|내용|기념일명?|제목)$/.test(String(v ?? '').replace(/\s/g, ''));
  const start = rows.findIndex(r => (r || []).some(isName));        // 맨 위 설명 줄 아래의 머리글 (첫 열이 비어 있어도 됨)
  const head = (rows[start] || []).map(h => String(h ?? '').replace(/\s/g, ''));
  const col = (re, def) => { const i = head.findIndex(h => re.test(h)); return i >= 0 ? i : def; };
  const C = { name: head.findIndex(isName), person: col(/^관련|인물/, -1), date: col(/^날짜/, 1), kind: col(/^종류/, -1), yearly: col(/^매년|반복/, -1), cal: col(/양력|음력/, -1) };
  const cell = (r, k) => (C[k] >= 0 ? r[C[k]] ?? '' : '');
  rows.slice(start + 1).forEach((r, i) => {
    const row = start + 2 + i;
    const name = String(cell(r, 'name')).trim();
    if (!name && !r.some(x => String(x ?? '').trim())) return;          // 빈 줄
    if (/\(예시\)$/.test(name)) return;
    if (!name) { skipped.push({ row, why: '이름 없음' }); return; }
    const raw = cell(r, 'date');
    let date = normDate(raw, excelDate), noYear = false;
    const leap = /윤/.test(String(raw));
    if (!date) {                                                       // 연도 없는 날짜: 10월 1일, 10/1, 10.1, 10-01
      const md = String(raw).replace(/윤/, '').trim().match(/^(\d{1,2})\s*[월/.-]\s*(\d{1,2})\s*일?$/);
      const dt = md && new Date(2000, Number(md[1]) - 1, Number(md[2]));
      if (md && dt.getMonth() === Number(md[1]) - 1) { date = `2000-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`; noYear = true; }
    }
    if (!date) { skipped.push({ row, why: `날짜 형식 오류 (${raw})` }); return; }
    const k = String(cell(r, 'kind')).trim();
    const kind = k ? (/생/.test(k) ? '생일' : '기념일') : /생신|생일/.test(name) ? '생일' : C.kind >= 0 ? '생일' : '기념일';
    const y = String(cell(r, 'yearly')).trim().toUpperCase();
    const yearly = !/^(X|N|NO|0|FALSE|아니|아니오|1회)/.test(y);
    const lunar = /음/.test(String(cell(r, 'cal'))) || /음력/.test(String(raw));
    // 관련 인물 칸이 없으면 "엄마 생신" → 엄마
    // (관련 인물 칸도 없고 알아낼 수 없으면 넣지 않아 기존 값을 지키고, 새 기념일은 빈칸)
    const person = C.person >= 0 ? String(cell(r, 'person')).trim() : kind === '생일' ? name.replace(/\s*(생신|생일).*$/, '').trim() : null;
    items.push({ name, ...(person == null ? {} : { person }), date, kind, yearly, lunar, leap: leap && lunar, noYear });
  });
  return { items, skipped };
}

/** 기존 목록에 합치기: 이름+날짜가 같으면 종류·반복만 갱신, 예시 기념일은 지운다 */
export function mergeAnniv(list, items, uid) {
  const out = list.filter(a => !/\(예시\)$/.test(a.name));
  let added = 0, updated = 0;
  items.forEach(it => {
    const i = out.findIndex(a => a.name === it.name && a.date === it.date);
    if (i >= 0) { out[i] = { ...out[i], ...it }; updated++; } else { out.push({ id: uid(), ...it }); added++; }
  });
  return { list: out, added, updated, removedExamples: list.length - list.filter(a => !/\(예시\)$/.test(a.name)).length };
}

/** 엑셀 내용으로 목록 전체 바꾸기: 엑셀에 없는 기념일은 지운다 (이름+날짜가 같으면 기존 id 유지) */
export function replaceAnniv(list, items, uid) {
  const seen = new Map();
  items.forEach(it => seen.set(`${it.name}|${it.date}`, it));          // 엑셀 안 중복은 마지막 줄
  const out = [...seen.values()].map(it => {
    const old = list.find(a => a.name === it.name && a.date === it.date);
    return old ? { ...old, ...it } : { id: uid(), ...it };
  });
  const kept = out.filter(a => list.some(b => b.id === a.id)).length;
  return { list: out, added: out.length - kept, updated: kept, removed: list.length - kept };
}
