import { iso, pad } from './data.js';

/* 음성으로 말한 문장에서 날짜·시간·제목을 뽑아낸다.
   예) "내일 오후 3시 반 치과 예약" → { date: 내일, time: '15:30', title: '치과 예약' } */

const NUM = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
const DOW = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const REL = { 오늘: 0, 내일: 1, 모레: 2, 내일모레: 2, 글피: 3 };

const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const toNum = s => (/^\d+$/.test(s) ? Number(s) : NUM[s]);

export function parseKoEvent(text, now = new Date()) {
  let t = ` ${text.replace(/\s+/g, ' ').trim()} `;
  const cut = re => { const m = t.match(re); if (m) t = t.replace(m[0], ' '); return m; };
  const today = addDays(now, 0);
  let date = null, time = '';

  // ── 날짜
  let m;
  if ((m = cut(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:에)?/))) {
    let y = m[1] ? Number(m[1]) : today.getFullYear();
    date = new Date(y, Number(m[2]) - 1, Number(m[3]));
    if (!m[1] && date < today) date = new Date(y + 1, Number(m[2]) - 1, Number(m[3]));
  } else if ((m = cut(/(다음|이번)\s*달\s*(\d{1,2})일(?:에)?/))) {
    date = new Date(today.getFullYear(), today.getMonth() + (m[1] === '다음' ? 1 : 0), Number(m[2]));
  } else if ((m = cut(/(다음|이번|다다음)\s*주\s*([일월화수목금토])요일(?:에|날)?/))) {
    const base = addDays(today, -today.getDay() + (m[1] === '다음' ? 7 : m[1] === '다다음' ? 14 : 0));
    date = addDays(base, DOW[m[2]]);
  } else if ((m = cut(/(내일모레|오늘|내일|모레|글피)(?:에|은|는)?/))) {
    date = addDays(today, REL[m[1]]);
  } else if ((m = cut(/([일월화수목금토])요일(?:에|날)?/))) {
    date = addDays(today, (DOW[m[1]] - today.getDay() + 7) % 7);
  } else if ((m = cut(/\s(\d{1,2})일(?:에|날)?\s/))) {
    date = new Date(today.getFullYear(), today.getMonth(), Number(m[1]));
    if (date < today) date = new Date(today.getFullYear(), today.getMonth() + 1, Number(m[1]));
  }

  // ── 시간
  if ((m = cut(/(\d{1,2}):(\d{2})(?:에)?/))) {
    time = `${pad(Number(m[1]))}:${m[2]}`;
  } else if ((m = cut(/(오전|오후|아침|점심|낮|저녁|밤|새벽)?\s*(\d{1,2}|열한|열두|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*시\s*(?:(반)|(\d{1,2})\s*분)?(?:에|부터|까지)?/))) {
    let h = toNum(m[2]);
    const mer = m[1];
    if (/오후|저녁|밤/.test(mer || '') && h < 12) h += 12;
    else if (/점심|낮/.test(mer || '') && h < 6) h += 12;
    else if (!mer && h >= 1 && h <= 6) h += 12;          // "3시 회의"처럼 오전·오후가 없으면 1~6시는 오후로 본다
    if (/오전|아침|새벽/.test(mer || '') && h === 12) h = 0;
    const min = m[3] ? 30 : m[4] ? Number(m[4]) : 0;
    if (h >= 0 && h < 24 && min < 60) time = `${pad(h)}:${pad(min)}`;
  }

  // ── 제목: 날짜·시간을 뺀 나머지에서 명령어 표현 정리
  const title = t
    .replace(/(일정\s*)?(을|를)?\s*(추가|등록|잡아|넣어|기록)\s*(해\s*줘|해\s*주세요|해|줘|하기|하자|할래)?\.?/g, ' ')
    .replace(/\s(에|은|는|에는)\s/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^[,.\s]+|[,.\s]+$/g, '');

  return { date: iso(date || today), time, title, area: guessArea(title) };
}

/** 제목 단어로 영역을 추정한다 (P 개인, B 사업, W 근로) */
export function guessArea(title) {
  if (/고객|거래처|매출|매입|발주|납품|계약|미팅|세금|부가세|사업|영업|마케팅|투자/.test(title)) return 'B';
  if (/회의|출근|퇴근|업무|보고|팀|상사|결재|근무|연차|교육/.test(title)) return 'W';
  return 'P';
}

/** 브라우저의 음성 인식 기능. 없으면 null */
export const SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
