import { iso, pad } from '../data.js';

/* 건강 관리 기록
   workouts: [{ id, date, type, minutes, kcal }]
   sleep:    [{ id, date(기상한 날), bed 'HH:MM', wake 'HH:MM' }]
   goalSleep: 목표 수면 시간(분) */
export const WORKOUT_TYPES = ['러닝', '걷기', '근력', '자전거', '수영', '스트레칭', '요가'];
const KCAL_PER_MIN = { 러닝: 10, 걷기: 4, 근력: 6, 자전거: 8, 수영: 9, 스트레칭: 3, 요가: 3 };
export const estimateKcal = (type, minutes) => Math.round((KCAL_PER_MIN[type] || 5) * minutes);

const hm = m => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** 취침~기상 사이 분 (자정을 넘기면 다음 날로 계산) */
export const sleepMinutes = (bed, wake) => { let d = toMin(wake) - toMin(bed); if (d <= 0) d += 1440; return d; };
export const fmtDur = m => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

/** 취침 시각 평균 (자정 전후를 이어서 계산) */
export const avgClock = (list, bedtime) => {
  if (!list.length) return '-';
  const v = list.map(s => { const m = toMin(s); return bedtime && m < 12 * 60 ? m + 1440 : m; });
  return hm(Math.round(v.reduce((a, b) => a + b, 0) / v.length));
};

/** 예시 기록: 오늘 이전 21일치 (시작 날짜로 정해지는 의사난수라 같은 날에는 같은 값) */
export function seedHealth(today = new Date()) {
  const workouts = [], sleep = [];
  let x = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const rnd = () => {                                           // mulberry32 의사난수
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 21; i >= 1; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const date = iso(d);
    if (rnd() < 0.7) {
      const type = WORKOUT_TYPES[Math.floor(rnd() * 5)];
      const minutes = 20 + Math.round(rnd() * 8) * 5;
      workouts.push({ id: `w${date}`, date, type, minutes, kcal: estimateKcal(type, minutes), src: '예시' });
    }
    const bed = 22 * 60 + 40 + Math.round(rnd() * 11) * 10;      // 22:40 ~ 00:30
    const wake = 6 * 60 + 10 + Math.round(rnd() * 9) * 10;       // 06:10 ~ 07:40
    sleep.push({ id: `s${date}`, date, bed: hm(bed), wake: hm(wake), src: '예시' });
  }
  return { workouts, sleep, goalSleep: 420, ...seedHealthExtra(today) };
}

/** 식단·병원 진찰 예시 (삼성 헬스에서 가져오기 전 화면이 비지 않도록) */
export function seedHealthExtra(today = new Date()) {
  const d = n => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
  const meals = [];
  const menu = [['아침', '그릭요거트와 과일', 320], ['점심', '비빔밥', 650], ['저녁', '닭가슴살 샐러드', 480], ['간식', '아메리카노·견과류', 180],
    ['아침', '토스트와 계란', 410], ['점심', '김치찌개 백반', 720], ['저녁', '연어 포케', 560]];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) { const [meal, name, kcal] = menu[(i + j * 2) % menu.length]; meals.push({ id: `m${i}${j}`, date: d(i), meal, name: `${name} (예시)`, kcal: kcal + ((i * 37 + j * 11) % 90) - 45, src: '예시' }); }
  const visits = [
    { id: 'v1', date: d(40), hospital: '서울내과 (예시)', dept: '내과', note: '감기 · 인후염', rx: '해열제 3일분', next: '' },
    { id: 'v2', date: d(12), hospital: '밝은치과 (예시)', dept: '치과', note: '스케일링', rx: '', next: d(-60) },
    { id: 'v3', date: d(3), hospital: '튼튼정형외과 (예시)', dept: '정형외과', note: '무릎 통증 · 물리치료', rx: '소염제 5일분', next: d(-4) },
  ];
  return { meals, visits, goalKcal: 2000 };
}
