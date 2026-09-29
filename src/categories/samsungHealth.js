import { unzipSync, strFromU8 } from 'fflate';
import { iso, pad } from '../data.js';

/* 삼성 헬스 "개인 데이터 다운로드" 파일 읽기
   - 삼성 헬스 앱 › 설정 › 개인 데이터 다운로드 로 받은 폴더(또는 압축 파일)의 CSV 를 읽는다
   - 파일 이름으로 종류를 구분: *exercise*.csv(운동), *sleep*.csv(수면), *food_intake*.csv(식단)
   - CSV 첫 줄은 "com.samsung.shealth.exercise,번호,버전" 같은 설명 줄이고 둘째 줄이 열 이름이다
   - 열 이름은 "com.samsung.health.exercise.start_time" 처럼 앞에 긴 이름이 붙기도 해서 끝부분으로 찾는다
   - 시각은 UTC 로 기록되고 time_offset 열(예: UTC+0900)이 있으면 그만큼 더해 현지 시각으로 바꾼다 */

/** 따옴표를 고려한 CSV 파서 */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

/** 설명 줄을 건너뛰고 { 열이름: 값 } 목록으로 */
function toObjects(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) return [];
  let h = 0;
  if (rows[0].length <= 3 && /samsung|shealth/.test(rows[0][0]) && rows.length > 1) h = 1;   // 설명 줄
  const head = rows[h].map(x => x.trim());
  return rows.slice(h + 1).map(r => Object.fromEntries(head.map((k, i) => [k, (r[i] ?? '').trim()])));
}
/** 열 이름 끝부분으로 값 찾기 */
const pick = (o, ...names) => {
  for (const n of names) {
    const k = Object.keys(o).find(x => x === n || x.endsWith(`.${n}`));
    if (k && o[k] !== '') return o[k];
  }
  return '';
};

/** 삼성 헬스 시각 → 현지 Date */
function toLocal(t, offset) {
  if (!t) return null;
  const m = String(t).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const n = Number(t); return Number.isFinite(n) && n > 1e11 ? new Date(n) : null; }
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const om = String(offset || '').match(/([+-])(\d{2}):?(\d{2})/);
  if (om) {                                                      // UTC 값 + 오프셋 → 현지 시각 숫자
    const off = (om[1] === '-' ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3]));
    const u = new Date(Date.UTC(y, mo - 1, d, h, mi, s || 0) + off * 60000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes());
  }
  return new Date(y, mo - 1, d, h, mi, s || 0);
}
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 운동 종류 코드 (삼성 헬스). 모르는 코드는 "운동 (코드)" 로 표시 */
export const EXERCISE_CODES = {
  0: '기타 운동', 1001: '걷기', 1002: '달리기', 2001: '야구', 3001: '골프', 4001: '배드민턴', 4003: '테니스',
  9001: '에어로빅', 9002: '요가', 10004: '줄넘기', 11007: '자전거', 13001: '하이킹', 13003: '등산', 14001: '수영',
  15003: '실내 자전거', 15004: '로잉머신', 15005: '러닝머신', 15006: '일립티컬', 10007: '필라테스', 10002: '근력 운동',
};
const MEALS = { 100001: '아침', 100002: '점심', 100003: '저녁', 100004: '간식', 100005: '간식', 100006: '간식' };

/** 파일 목록 → { workouts, sleep, meals, files } */
export function parseSamsungFiles(files) {
  const out = { workouts: [], sleep: [], meals: [], files: [] };
  for (const f of files) {
    const name = f.name.split('/').pop();
    if (!/\.csv$/i.test(name)) continue;
    let kind = null;
    if (/food_intake/i.test(name)) kind = 'meal';
    else if (/sleep_stage|sleep_combined|sleep_raw|sleep_snoring/i.test(name)) kind = null;   // 단계·원시 데이터는 건너뜀
    else if (/sleep/i.test(name)) kind = 'sleep';
    else if (/exercise/i.test(name) && !/weather|periodization|recovery|custom|routine|hr_zone|max_heart|mapping|live_data|location|program/i.test(name)) kind = 'workout';
    if (!kind) continue;
    const rows = toObjects(f.text);
    let n = 0;
    rows.forEach(o => {
      const off = pick(o, 'time_offset');
      const st = toLocal(pick(o, 'start_time'), off), en = toLocal(pick(o, 'end_time'), off);
      if (!st) return;
      if (kind === 'workout') {
        const durMs = Number(pick(o, 'duration')) || (en ? en - st : 0);
        const minutes = Math.round(durMs / 60000);
        if (minutes <= 0) return;
        const code = Number(pick(o, 'exercise_type'));
        const kcal = Math.round(Number(pick(o, 'calorie', 'total_calorie')) || 0);
        const dist = Number(pick(o, 'distance')) || 0;
        out.workouts.push({ key: `sh-ex-${st.getTime()}`, date: iso(st), time: hhmm(st), type: EXERCISE_CODES[code] || `운동 (${code || '?'})`, minutes, kcal, km: dist ? Math.round(dist / 100) / 10 : 0, src: '삼성 헬스' });
      } else if (kind === 'sleep') {
        if (!en || en <= st) return;
        out.sleep.push({ key: `sh-sl-${st.getTime()}`, date: iso(en), bed: hhmm(st), wake: hhmm(en), mins: Math.round((en - st) / 60000), score: Number(pick(o, 'sleep_score', 'efficiency')) || 0, src: '삼성 헬스' });
      } else {
        const kcal = Math.round(Number(pick(o, 'calorie')) || 0);
        const food = pick(o, 'name', 'food_name', 'title') || '음식';
        out.meals.push({ key: `sh-fd-${st.getTime()}-${food}`, date: iso(st), meal: MEALS[Number(pick(o, 'meal_type'))] || '간식', name: food, kcal, src: '삼성 헬스' });
      }
      n++;
    });
    if (n) out.files.push(`${name} (${n}건)`);
  }
  // 수면: 같은 날(기상일) 기록이 여러 개면 가장 긴 잠 하나만
  const best = {};
  out.sleep.forEach(s => { if (!best[s.date] || s.mins > best[s.date].mins) best[s.date] = s; });
  out.sleep = Object.values(best);
  return out;
}

/** <input type=file> 로 고른 파일들 → [{ name, text }] (zip 은 풀어서) */
export async function readFiles(fileList) {
  const res = [];
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name)) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const entries = unzipSync(buf, { filter: f => /\.csv$/i.test(f.name) && /exercise|sleep|food_intake/i.test(f.name) });
      for (const [name, data] of Object.entries(entries)) res.push({ name, text: strFromU8(data) });
    } else if (/\.csv$/i.test(file.name)) {
      res.push({ name: file.name, text: await file.text() });
    }
  }
  return res;
}

/** 기존 기록에 합치기 (같은 key 는 새 값으로 덮어씀, 같은 날 수면은 삼성 헬스 값 우선) */
export function mergeImport(h, imp, now) {
  const byKey = (list, add) => { const m = new Map(list.map(x => [x.key || x.id, x])); add.forEach(x => m.set(x.key, { id: x.key, ...x })); return [...m.values()]; };
  // 실제 데이터를 가져오면 예시 기록(운동·수면·식단)은 지운다
  const real = x => x.src !== '예시' && !/^[ws]\d{4}-\d{2}-\d{2}$/.test(x.id || '');
  const sleepDates = new Set(imp.sleep.map(s => s.date));
  return {
    ...h,
    workouts: byKey(h.workouts.filter(real), imp.workouts),
    sleep: [...h.sleep.filter(real).filter(s => !sleepDates.has(s.date)), ...imp.sleep.map(s => ({ id: s.key, ...s }))],
    meals: byKey((h.meals || []).filter(real), imp.meals),
    imported: { at: `${iso(now)} ${hhmm(now)}`, counts: { workouts: imp.workouts.length, sleep: imp.sleep.length, meals: imp.meals.length }, files: imp.files },
  };
}
