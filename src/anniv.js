import { iso } from './data.js';

/* 기념일: { id, name, date: 'YYYY-MM-DD'(처음 날짜), kind: '생일' | '기념일', yearly: 매년 반복 여부 } */
export const ANNIV_KINDS = ['생일', '기념일'];

export const seedAnniv = () => [
  { id: 'an1', name: '친구 생일 (예시)', date: '1990-09-30', kind: '생일', yearly: true },
  { id: 'an2', name: '어머니 생신 (예시)', date: '1965-10-03', kind: '생일', yearly: true },
  { id: 'an3', name: '결혼기념일 (예시)', date: '2016-10-07', kind: '기념일', yearly: true },
  { id: 'an4', name: '입사 기념일 (예시)', date: '2021-11-02', kind: '기념일', yearly: true },
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
