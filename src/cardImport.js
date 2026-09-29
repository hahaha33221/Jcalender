import { excelDate, readXlsx } from './xlsx.js';
import { readXls } from './xls.js';
import { parseCsv } from './categories/samsungHealth.js';

/* 카드 이용내역 파일 → 지출 내역 (개인 재무)
   - 카드사 홈페이지·앱의 "이용내역 조회 → 엑셀 저장" 파일: .xls(옛 엑셀 또는 HTML 표) · .xlsx · .csv
   - 열은 머리글 이름으로 찾는다(카드사·기간마다 열 순서가 달라도 됨): 이용일 · 가맹점 · 이용금액 · 상태 · 승인번호 …
   - 취소 건과 합계 줄은 빼고, 같은 승인번호(없으면 날짜+금액+가맹점)는 한 번만 넣는다 */
export const CARD_COMPANIES = ['롯데카드', 'KB국민카드'];

/** 한글 글자 코드: UTF-8 이 깨지면 EUC-KR 로 다시 읽는다 */
function decode(buf) {
  const u = new TextDecoder('utf-8').decode(buf);
  if (!/\uFFFD/.test(u)) return u.replace(/^\uFEFF/, '');
  try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { return u; }
}
/** HTML 표(확장자만 .xls 인 파일) → 가장 큰 표의 행 */
function htmlRows(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const tables = [...doc.querySelectorAll('table')];
  if (!tables.length) return null;
  const t = tables.sort((a, b) => b.rows.length - a.rows.length)[0];
  return [...t.rows].map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
}

/** 파일 → 표 [[셀...]] */
export async function readTable(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);                 // .xlsx (zip)
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return readXls(buf);                  // 옛 .xls
  const text = decode(buf);
  if (/<table/i.test(text)) return htmlRows(text);
  return parseCsv(text);
}

const H = {
  date: /^(이용|거래|승인|매출)(일|일자|일시|날짜)|^이용 ?일자?$|^날짜$/,
  time: /(이용|승인|거래)시간/,
  merchant: /가맹점|이용 ?하신 ?곳|이용처|사용처|상호|이용내역/,
  amount: /(이용|승인|거래|결제)금액|^금액$|^이용 ?금액/,
  status: /상태|취소|승인구분|결제구분|^구분$/,
  approval: /승인번호/,
  card: /이용카드|카드명|카드구분|카드번호/,
  plan: /할부|결제방법|이용구분/,
};
const BAD = { merchant: /번호|정보|업종|주소|코드|전화/, amount: /할인|포인트|수수료|예정|잔액|원금|해외|환율|외화|이자|적립/ };

/** 머리글 줄과 열 위치 찾기 (처음 40줄 안에서 날짜·금액 머리글이 함께 있는 줄) */
function findHeader(rows) {
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const h = rows[i].map(x => String(x ?? '').replace(/\s+/g, ' ').trim());
    const col = k => h.findIndex(x => x && H[k].test(x.replace(/\s/g, '')) && !(BAD[k] && BAD[k].test(x)));
    const c = Object.fromEntries(Object.keys(H).map(k => [k, col(k)]));
    if (c.date >= 0 && c.amount >= 0) return { i, c };
  }
  return null;
}

/** 날짜 칸 → YYYY-MM-DD (엑셀 날짜 숫자, 2026.09.28, 26.09.28, 2026-09-28 12:31, 2026년 9월 28일, 09/28) */
export function cardDate(v, year) {
  if (typeof v === 'number') return v > 19000000 ? cardDate(String(v), year) : excelDate(v);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/) || s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) { const k = s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})/); if (k) m = [0, `20${k[1]}`, k[2], k[3]]; }
  if (!m) { const k = s.match(/^(\d{1,2})[-./월]\s*(\d{1,2})/); if (k) m = [0, String(year), k[1], k[2]]; }
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const money = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0);

/** 가맹점 이름으로 분류 추측 (개인 재무 분류: 식비·생활용품·교통·여가·선물·의료·기타) */
const GUESS = [
  ['교통', /택시|카카오T|버스|지하철|철도|코레일|KTX|SRT|티머니|주유|주차|하이패스|고속도로|항공|쏘카|타다|SK에너지|GS칼텍스|S-OIL|오일/i],
  ['의료', /병원|의원|약국|치과|한의원|안과|피부과|정형외과|내과|소아과|검진|메디/],
  ['여가', /CGV|메가박스|롯데시네마|영화|넷플릭스|NETFLIX|유튜브|YOUTUBE|멜론|스포티파이|SPOTIFY|티빙|웨이브|왓챠|디즈니|노래|볼링|PC방|헬스|필라테스|골프|여행|호텔|숙박|야놀자|여기어때|에어비앤비|공연|티켓|인터파크|책|교보|YES24|알라딘|서점/i],
  ['선물', /꽃|플라워|선물|기프트|카카오선물/],
  ['생활용품', /다이소|올리브영|쿠팡|이마트|홈플러스|롯데마트|코스트코|트레이더스|마트|11번가|G마켓|옥션|SSG|무신사|이케아|IKEA|생활/i],
  ['식비', /스타벅스|커피|카페|투썸|이디야|메가|빽다방|배달|요기요|쿠팡이츠|배민|우아한|편의점|GS25|CU|세븐일레븐|이마트24|베이커리|파리바게|뚜레쥬르|버거|맥도날드|롯데리아|치킨|피자|김밥|식당|분식|국밥|고기|횟집|푸드|음식|레스토랑|주점|호프/i],
];
export const guessCat = name => (GUESS.find(([, re]) => re.test(name)) || ['기타'])[0];

/** 카드사 추측: 선택값 → 파일 이름 → 표 안 글자 */
function detectCompany(pick, fileName, rows) {
  if (pick && pick !== 'auto') return pick;
  const hay = `${fileName} ${rows.slice(0, 10).flat().join(' ')}`;
  if (/롯데|lotte/i.test(hay)) return '롯데카드';
  if (/국민|KB|kbcard/i.test(hay)) return 'KB국민카드';
  return '카드';
}

/** 표 → { company, items: [{ key, date, amount, merchant, cat, card, plan }], cancelled, skipped } */
export function parseCardRows(rows, { pick = 'auto', fileName = '', year = new Date().getFullYear() } = {}) {
  const found = findHeader(rows);
  if (!found) throw new Error('이용일·이용금액 머리글을 찾지 못했습니다. 카드사 이용내역 엑셀 파일인지 확인해 주세요');
  const { i, c } = found, company = detectCompany(pick, fileName, rows);
  const get = (r, k) => (c[k] >= 0 ? r[c[k]] ?? '' : '');
  const items = [], seen = new Set();
  let cancelled = 0, skipped = 0;
  rows.slice(i + 1).forEach(r => {
    const first = String(r.find(x => String(x ?? '').trim()) ?? '');
    if (!first || /합계|소계|총계|총 ?이용/.test(first)) return;
    const date = cardDate(get(r, 'date'), year), amount = money(get(r, 'amount'));
    if (!date || !amount) { if (r.some(x => String(x ?? '').trim())) skipped++; return; }
    const st = `${get(r, 'status')} ${get(r, 'plan')}`;
    if (amount < 0 || /취소|거절|승인거절|환불/.test(st)) { cancelled++; return; }
    const merchant = String(get(r, 'merchant') || '').trim() || '카드 결제';
    const appr = String(get(r, 'approval') || '').trim();
    const key = `${company}|${appr || `${date}|${amount}|${merchant}`}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ key, date, amount: Math.round(amount), merchant, cat: guessCat(merchant), card: String(get(r, 'card') || '').trim(), plan: String(get(r, 'plan') || '').trim() });
  });
  return { company, items, cancelled, skipped };
}

/** 지출 내역에 합치기: 이미 있는 key 는 건너뛰고, 처음 가져올 때 예시 지출은 지운다 */
export function mergeCard(fin, { company, items }, uid) {
  const real = fin.expenses.filter(e => !/\(예시\)$/.test(e.memo || ''));
  const have = new Set(real.map(e => e.cardKey).filter(Boolean));
  const add = items.filter(x => !have.has(x.key)).map(x => ({ id: uid(), date: x.date, amount: x.amount, cat: x.cat, memo: x.merchant, card: company, cardKey: x.key }));
  return { fin: { ...fin, expenses: [...real, ...add] }, added: add.length, dup: items.length - add.length, removedExamples: fin.expenses.length - real.length };
}
