/* 캘린더에 모이는 날짜 데이터를 한 가지 모양으로 바꾸는 층 (일정 소스 통합)
   항목 = { key, kind: 기념일|D-day|기획 마감|조사 마감|마일스톤, label, src: { type, id } }
   일정(events)은 끌어 옮기기·수정이 있어 캘린더가 따로 그리고, 여기서는 읽기 전용 소스만 모은다 */
import { annivOn } from './anniv.js';
import { ddaysOn } from './dday.js';

export function sourcesOn(store, key) {
  const out = [];
  annivOn(store.anniv || [], key).forEach(a => out.push({ key: `a:${a.id}`, kind: a.kind || '기념일', label: a.name, src: { type: 'anniv', id: a.id }, cls: '' }));
  ddaysOn(store.ddays, key).forEach(x => out.push({ key: `d:${x.id}`, kind: 'D-day', label: x.label, src: { type: 'dday', id: x.id }, cls: 'cal-dd' }));
  (store.plan?.plans || []).forEach(p => { if (p.due === key && p.status !== '확정' && p.status !== '보류') out.push({ key: `p:${p.id}`, kind: '기획 마감', label: `${p.title} 마감`, src: { type: 'plan', id: p.id }, cls: 'cal-src' }); });
  (store.plan?.topics || []).forEach(t => { if (t.due === key && t.status !== '정리 완료') out.push({ key: `t:${t.id}`, kind: '조사 마감', label: `${t.title} 조사 마감`, src: { type: 'topic', id: t.id }, cls: 'cal-src' }); });
  Object.entries(store.goals?.boards || {}).forEach(([bk, b]) => (b.miles || []).forEach(m => {
    if (m.date === key && !m.done) out.push({ key: `m:${bk}:${m.id}`, kind: '마일스톤', label: m.name, src: { type: 'milestone', id: m.id, board: bk }, cls: 'cal-mile' });
  }));
  return out;
}
