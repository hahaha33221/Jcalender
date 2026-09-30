/* 반복 일정 (매일 · 매주 · 매월)
   일정 = { id, date(첫 날), time, title, area, memo, repeat?: { freq: 'D'|'W'|'M', until: 'YYYY-MM-DD' | '', skip: ['YYYY-MM-DD'] } }
   - 반복 일정은 한 건만 저장하고, 화면에 그릴 때 기간 안의 날짜로 펼친다 (expandEvents)
   - 펼친 한 회차 = { ...일정, id: '원래id@날짜', sid: 원래 id, date: 그 날짜 }
   - 매월은 첫 날의 "일"을 따른다 (31일 반복이면 30일까지인 달은 건너뜀)
   - 한 회차만 지우거나 옮기면 skip 에 그 날짜를 넣는다 */
import { iso } from './data.js';

export const FREQ = { '': '반복 안 함', D: '매일', W: '매주', M: '매월' };
const toD = s => new Date(`${s}T00:00:00`);
const addDays = (s, n) => { const d = toD(s); d.setDate(d.getDate() + n); return iso(d); };

/** 반복 설명 (예: 매주 수요일 · 12/31까지) */
export function repeatText(e) {
  const r = e.repeat;
  if (!r?.freq) return '';
  const d = toD(e.date);
  const base = r.freq === 'D' ? '매일' : r.freq === 'W' ? `매주 ${'일월화수목금토'[d.getDay()]}요일` : `매월 ${d.getDate()}일`;
  return `${base}${r.until ? ` · ${Number(r.until.slice(5, 7))}/${Number(r.until.slice(8, 10))}까지` : ''}`;
}

/** 한 반복 일정의 from~to 사이 날짜들 */
export function occurrences(e, from, to) {
  const r = e.repeat;
  if (!r?.freq) return e.date >= from && e.date <= to ? [e.date] : [];
  const end = r.until && r.until < to ? r.until : to;
  const skip = new Set(r.skip || []);
  const out = [];
  if (e.date > end) return out;
  if (r.freq === 'D' || r.freq === 'W') {
    const step = r.freq === 'D' ? 1 : 7;
    let k = e.date;
    if (k < from) { const gap = Math.round((toD(from) - toD(k)) / 864e5); k = addDays(k, Math.ceil(gap / step) * step); }
    for (; k <= end; k = addDays(k, step)) if (!skip.has(k)) out.push(k);
  } else {
    const day = toD(e.date).getDate(), s0 = toD(e.date > from ? e.date : from);
    for (let i = 0; i < 400; i++) {
      const d = new Date(s0.getFullYear(), s0.getMonth() + i, day);
      if (d.getDate() !== day) continue;                     // 그 달에 없는 날(31일 등)
      const k = iso(d);
      if (k > end) break;
      if (k >= from && k >= e.date && !skip.has(k)) out.push(k);
    }
  }
  return out;
}

/** 일정 목록을 from~to 사이의 회차로 펼친다 */
export function expandEvents(events, from, to) {
  const out = [];
  for (const e of events) {
    if (!e.repeat?.freq) { if (e.date >= from && e.date <= to) out.push(e); continue; }
    for (const k of occurrences(e, from, to)) out.push({ ...e, id: `${e.id}@${k}`, sid: e.id, date: k });
  }
  return out;
}

/** 반복 일정에서 한 날짜만 빼기 */
export const skipDate = (events, sid, date) => events.map(x => (x.id === sid ? { ...x, repeat: { ...x.repeat, skip: [...new Set([...(x.repeat.skip || []), date])] } } : x));
