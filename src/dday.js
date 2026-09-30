/* D-day 관리
   store.ddays = [{ id, name, date: 'YYYY-MM-DD', mode: 'until' | 'since', startOne: 시작일을 1일로 셀지(since), pin: 대시보드 표시, memo }]
   - until (목표일까지): 오늘 기준 D-12, 당일 D-day, 지나면 D+3
   - since (시작일부터): 시작일을 1일로 세면 "100일째", 아니면 D+99. 100일 단위와 매년 주년을 다음 기념으로 보여 준다 */
import { iso } from './data.js';

const toD = s => new Date(`${s}T00:00:00`);
const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const diffDays = (from, to) => Math.round((day0(to) - day0(from)) / 864e5);

/** 화면에 쓸 값: { big: 'D-12', sub: '...', n, soon, past } */
export function ddayInfo(x, today) {
  const t = day0(today), d = toD(x.date);
  const diff = diffDays(t, d);                                  // 목표일까지 남은 날 (지나면 음수)
  if (x.mode === 'until') {
    return { big: diff === 0 ? 'D-day' : diff > 0 ? `D-${diff}` : `D+${-diff}`, n: diff, past: diff < 0, soon: diff >= 0 && diff <= 7 };
  }
  const passed = -diff;                                         // 시작일부터 지난 날
  if (passed < 0) return { big: `D-${-passed}`, n: passed, sub: '시작 전', soon: -passed <= 7, past: false };
  const count = x.startOne ? passed + 1 : passed;
  return { big: x.startOne ? `${count.toLocaleString()}일째` : `D+${count.toLocaleString()}`, n: count, past: false, soon: false, next: nextMilestone(x, today) };
}

/** 시작일부터 세는 D-day 의 다음 기념 (100일 단위 · 주년 중 가까운 것) */
export function nextMilestone(x, today) {
  const t = day0(today), start = toD(x.date);
  const off = x.startOne ? 1 : 0;                                // 1일부터 세면 100일째 = 시작 + 99일
  const passed = diffDays(start, t) + off;
  const hundred = (Math.floor(passed / 100) + 1) * 100;
  const hDate = new Date(start); hDate.setDate(hDate.getDate() + hundred - off);
  let yr = t.getFullYear() - start.getFullYear();
  let yDate = new Date(start.getFullYear() + yr, start.getMonth(), start.getDate());
  if (yDate <= t) { yr += 1; yDate = new Date(start.getFullYear() + yr, start.getMonth(), start.getDate()); }
  const cands = [{ label: `${hundred.toLocaleString()}일`, date: hDate }, ...(yr > 0 ? [{ label: `${yr}주년`, date: yDate }] : [])];
  const best = cands.sort((a, b) => a.date - b.date)[0];
  return { ...best, key: iso(best.date), dday: diffDays(t, best.date) };
}

/** 달력 칸에 표시할 D-day (목표일, 시작일부터 세는 D-day 의 100일 단위·주년) */
export function ddaysOn(list, key) {
  const out = [];
  for (const x of list || []) {
    if (x.mode === 'until') { if (x.date === key) out.push({ id: x.id, label: `${x.name} D-day` }); continue; }
    if (key <= x.date) continue;
    const off = x.startOne ? 1 : 0, passed = diffDays(toD(x.date), toD(key)) + off;
    if (passed > 0 && passed % 100 === 0) out.push({ id: x.id, label: `${x.name} ${passed}일` });
    else if (key.slice(5) === x.date.slice(5)) out.push({ id: x.id, label: `${x.name} ${Number(key.slice(0, 4)) - Number(x.date.slice(0, 4))}주년` });
  }
  return out;
}

export const seedDdays = () => [];
