import { iso } from './data.js';

/* 기념일: { id, name, person(관련 인물, 자유 입력), date: 'YYYY-MM-DD'(처음 날짜), kind: '생일' | '기념일', yearly: 매년 반복 여부 } */
export const ANNIV_KINDS = ['생일', '기념일'];

export const seedAnniv = () => [
  { id: 'an1', name: '친구 생일 (예시)', person: '김민수 (고등학교 친구)', date: '1990-09-30', kind: '생일', yearly: true },
  { id: 'an2', name: '어머니 생신 (예시)', person: '어머니', date: '1965-10-03', kind: '생일', yearly: true },
  { id: 'an3', name: '결혼기념일 (예시)', person: '배우자', date: '2016-10-07', kind: '기념일', yearly: true },
  { id: 'an4', name: '입사 기념일 (예시)', person: '본인', date: '2021-11-02', kind: '기념일', yearly: true },
];

const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** today 이후(당일 포함) 가장 가까운 날짜와 D-day. 지난 1회성 기념일은 null */
export function nextAnniv(a, today) {
  const [y, m, d] = a.date.split('-').map(Number);
  const t = day0(today);
  let next = a.yearly ? new Date(t.getFullYear(), m - 1, d) : new Date(y, m - 1, d);
  if (a.yearly && next < t) next = new Date(t.getFullYear() + 1, m - 1, d);
  if (next < t) return null;
  const dday = Math.round((next - t) / 864e5);
  const years = a.yearly ? next.getFullYear() - y : 0;
  return { date: next, key: iso(next), dday, years };
}

/** 날짜(YYYY-MM-DD)별 기념일 목록 (캘린더 표시용) */
export function annivOn(list, key) {
  const [, m, d] = key.split('-');
  return list.filter(a => (a.yearly ? a.date.slice(5) === `${m}-${d}` : a.date === key));
}

/* ── 엑셀 양식 · 업로드 ──
   열: 이름 | 관련 인물 | 날짜 | 종류(생일/기념일) | 매년 반복(O/X)
   열은 머리글 이름으로 찾으므로 예전 양식(관련 인물 없음)도 올릴 수 있다
   이름이 "(예시)" 로 끝나는 줄은 건너뛴다 */
export const ANNIV_HEAD = ['이름', '관련 인물', '날짜 (YYYY-MM-DD)', '종류 (생일/기념일)', '매년 반복 (O/X)'];

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
  const start = rows.findIndex(r => String(r[0] ?? '').trim() === '이름');   // 맨 위 설명 줄 아래의 머리글
  const head = (rows[start] || []).map(h => String(h ?? '').replace(/\s/g, ''));
  const col = (re, def) => { const i = head.findIndex(h => re.test(h)); return i >= 0 ? i : def; };
  const C = { name: 0, person: col(/^관련|인물/, -1), date: col(/^날짜/, 1), kind: col(/^종류/, 2), yearly: col(/^매년|반복/, 3) };
  const cell = (r, k) => (C[k] >= 0 ? r[C[k]] ?? '' : '');
  rows.slice(start + 1).forEach((r, i) => {
    const row = start + 2 + i;
    const name = String(cell(r, 'name')).trim();
    if (!name && !r.some(x => String(x ?? '').trim())) return;          // 빈 줄
    if (/\(예시\)$/.test(name)) return;
    if (!name) { skipped.push({ row, why: '이름 없음' }); return; }
    const date = normDate(cell(r, 'date'), excelDate);
    if (!date) { skipped.push({ row, why: `날짜 형식 오류 (${cell(r, 'date')})` }); return; }
    const k = String(cell(r, 'kind')).trim();
    const kind = !k ? '생일' : /생/.test(k) ? '생일' : '기념일';
    const y = String(cell(r, 'yearly')).trim().toUpperCase();
    const yearly = !/^(X|N|NO|0|FALSE|아니|아니오|1회)/.test(y);
    items.push({ name, person: String(cell(r, 'person')).trim(), date, kind, yearly });
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
