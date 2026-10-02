import { excelDate, readXlsx } from './xlsx.js';
import { readXls } from './xls.js';
import { parseCsv } from './categories/samsungHealth.js';

/* 카드 이용내역 파일 → 지출 내역 (개인 재무)
   - 카드사 홈페이지·앱의 "이용내역 조회 → 엑셀 저장" 파일: .xls(옛 엑셀 또는 HTML 표) · .xlsx · .csv
   - 열은 머리글 이름으로 찾는다(카드사·기간마다 열 순서가 달라도 됨): 이용일 · 가맹점 · 이용금액 · 상태 · 승인번호 …
   - 분류는 개인 재무 › 지출 카테고리 설정의 포함 범위(키워드)로 정한다 (guess 인자)
   - 이용 시간(시간 열 또는 날짜 칸의 시각)이 있으면 time 'HH:MM' 으로 함께 저장
   - 취소 건과 합계 줄은 빼고, 같은 승인번호(없으면 날짜+금액+가맹점)는 한 번만 넣는다 */
export const CARD_COMPANIES = ['롯데카드', 'KB국민카드'];

/** 한글 글자 코드: UTF-8 이 깨지면 EUC-KR 로 다시 읽는다 */
function decode(buf) {
  const u = new TextDecoder('utf-8').decode(buf);
  if (!/\uFFFD/.test(u)) return u.replace(/^\uFEFF/, '');
  try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { return u; }
}
/** HTML 표 → 칸 배열. 병합 칸(rowspan·colspan)은 같은 글자로 풀어서 열 위치를 맞춘다 */
function gridOf(t) {
  const out = [];
  [...t.rows].forEach((r, ri) => {
    out[ri] ||= [];
    let ci = 0;
    [...r.cells].forEach(cell => {
      while (out[ri][ci] !== undefined) ci++;
      const v = cell.textContent.replace(/\s+/g, ' ').trim(), rs = cell.rowSpan || 1, cs = cell.colSpan || 1;
      for (let y = 0; y < rs; y++) for (let x = 0; x < cs; x++) { (out[ri + y] ||= [])[ci + x] = v; }
      ci += cs;
    });
  });
  return out.map(r => Array.from(r, x => x ?? ''));
}
/** HTML 표(확장자만 .xls 인 파일) → 이용일·금액 머리글이 있는 표 중 가장 큰 표
    (롯데카드 이용대금명세서: 요약 표 · 이용 내역 표 · 해외 이용 표 중 이용 내역 표. 해외 이용은 이용 내역에도 들어 있다) */
function htmlRows(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const grids = [...doc.querySelectorAll('table')].map(gridOf).sort((a, b) => b.length - a.length);
  if (!grids.length) return null;
  return grids.find(g => findHeader(g)) || grids[0];
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
  amount: /(이용|승인|거래|결제)금액|^금액$|^이용 ?금액|이용총액/,
  status: /상태|취소|승인구분|결제구분|^구분$/,
  approval: /승인번호/,
  card: /이용카드|카드명|카드구분|카드번호/,
  plan: /할부|결제방법|이용구분/,
  // 이용대금명세서 전용: 회차 · 이번 달 청구 원금 · 수수료
  foreign: /해외이용금액|해외금액|외화/,
  round: /^회차$/,
  principal: /원금/,
  fee: /수수료/,
};
const BAD = { merchant: /번호|정보|업종|주소|코드|전화/, amount: /할인|포인트|수수료|예정|잔액|원금|해외|환율|외화|이자|적립/, plan: /회차/, fee: /해외/ };

/** 머리글 줄과 열 위치 찾기 (처음 40줄 안에서 날짜·금액 머리글이 함께 있는 줄)
    바로 아래 줄이 날짜가 아닌 작은 머리글(예: 이번 달 입금하실 금액 → 원금 · 수수료)이면 합쳐서 본다 */
function findHeader(rows) {
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const clean = r => (r || []).map(x => String(x ?? '').replace(/\s+/g, ' ').trim());
    let h = clean(rows[i]), skip = 0;
    const sub = clean(rows[i + 1]);
    const isData = (rows[i + 1] || []).some(x => (typeof x === 'number' ? x > 20000 && x < 80000 : cardDate(x, 2000)));   // 날짜(엑셀 날짜 숫자 포함)가 있으면 자료 줄
    if (sub.length && !isData && sub.some((x, k) => x && x !== h[k])) { h = h.map((x, k) => (sub[k] && sub[k] !== x ? `${x} ${sub[k]}` : x)); skip = 1; }
    const col = k => h.findIndex(x => x && H[k].test(x.replace(/\s/g, '')) && !(BAD[k] && BAD[k].test(x)));
    const c = Object.fromEntries(Object.keys(H).map(k => [k, col(k)]));
    if (c.date >= 0 && (c.amount >= 0 || c.principal >= 0)) return { i: i + skip, c };
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
/** 이용 시간 → HH:MM (시간 열, 또는 날짜 칸에 붙은 "2026-09-28 12:31", 엑셀 날짜·시간 숫자의 소수 부분). 없으면 '' */
export function cardTime(dateCell, timeCell) {
  const pick = v => {
    if (typeof v === 'number') {
      const fr = v < 1 ? v : v % 1;
      if (!(fr > 0)) return '';
      const mins = Math.round(fr * 1440) % 1440;
      return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    }
    const m = String(v ?? '').match(/(?:^|\s|T)(\d{1,2}):(\d{2})/);
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
  };
  return pick(timeCell) || pick(dateCell);
}
/** 할부 칸 → 개월 수 ("3개월" · "할부(03)" · "2/6" · "일시불" → 0) */
export function planMonths(v) {
  const t = String(v ?? '').replace(/\s+/g, '');
  if (!t || /일시불/.test(t)) return 0;
  let m = t.match(/(\d+)개월/); if (m) return Number(m[1]);
  m = t.match(/(\d+)\/(\d+)/); if (m) return Number(m[2]);
  m = t.match(/(\d+)/); return m ? Number(m[1]) : 0;
}
/** 지출 한 줄의 할부 정보: 저장된 inst, 없으면 내용의 "(할부 2/6회차)" · "(할부 6개월)" 에서 → { months, round } | null */
export function instOf(e) {
  if (e?.inst?.months > 1) return e.inst;
  const t = String(e?.memo || '');
  let m = t.match(/할부\s*(\d+)\s*\/\s*(\d+)\s*회차/); if (m && Number(m[2]) > 1) return { months: Number(m[2]), round: Number(m[1]) };
  m = t.match(/할부\s*(\d+)\s*개월/); if (m && Number(m[1]) > 1) return { months: Number(m[1]) };
  return null;
}
export const instText = i => (i ? `할부 ${i.months}개월${i.round ? ` · ${i.round}회차` : ''}` : '');
/** 내용에서 "(할부 …)" 꼬리표를 뺀 이름 (할부 표시를 따로 붙일 때) */
export const memoNoInst = t => String(t || '').replace(/\s*\(할부[^)]*\)\s*$/, '');
const money = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0);

/** 카드사 추측: 선택값 → 파일 이름 → 표 안 글자 */
function detectCompany(pick, fileName, rows) {
  if (pick && pick !== 'auto') return pick;
  const hay = `${fileName} ${rows.slice(0, 10).flat().join(' ')}`;
  if (/롯데카드|lotte|로카|LOCA/i.test(hay)) return '롯데카드';
  if (/국민|KB|kbcard/i.test(hay)) return 'KB국민카드';
  return '카드';
}

/** 표 → { company, statement, billTotal, stmtDate, items: [{ key, date, amount, merchant, cat, card, plan }], cancelled, skipped }
    이용대금명세서(원금 열이 있는 표)는 줄마다 이렇게 넣는다
    - 일시불: 원금 (이번 달 청구 금액 = 이용 금액)
    - 할부 installment='bill' (기본): 이번 달 청구분 = 원금 + 수수료, 날짜는 명세서 기준일(표에서 가장 늦은 이용일), 회차마다 따로
      → 가져온 합계가 명세서 청구 합계와 같다
    - 할부 installment='use': 이용총액 전체를 이용일에 한 번만 (다음 달 명세서의 같은 할부는 중복으로 건너뜀) */
export function parseCardRows(rows, { pick = 'auto', fileName = '', year = new Date().getFullYear(), guess = () => '기타', installment = 'bill' } = {}) {
  const found = findHeader(rows);
  if (!found) throw new Error('이용일·이용금액 머리글을 찾지 못했습니다. 카드사 이용내역 엑셀 파일인지 확인해 주세요');
  const { i, c } = found, company = detectCompany(pick, fileName, rows);
  const statement = c.principal >= 0;
  const get = (r, k) => (c[k] >= 0 ? r[c[k]] ?? '' : '');
  const body = rows.slice(i + 1).filter(r => {
    const first = String(r.find(x => String(x ?? '').trim()) ?? '');
    return first && !/합계|소계|총계|총 ?이용/.test(first);
  });
  const stmtDate = body.map(r => cardDate(get(r, 'date'), year)).filter(Boolean).sort().pop() || '';
  const items = [], used = {};
  let cancelled = 0, skipped = 0, billTotal = 0, foreign = 0;
  body.forEach(r => {
    const useDate = cardDate(get(r, 'date'), year);
    const merchant = String(get(r, 'merchant') || '').trim() || '카드 결제';
    const round = money(get(r, 'round')), months = planMonths(get(r, 'plan'));
    const inst = statement && round > 0;
    const bill = statement ? money(get(r, 'principal')) + money(get(r, 'fee')) : 0;
    let date = useDate, amount, tag = '';
    if (!statement) amount = money(get(r, 'amount'));
    else if (!inst) amount = money(get(r, 'principal')) || money(get(r, 'amount'));
    else if (installment === 'use') { amount = money(get(r, 'amount')); tag = ` (할부 ${months}개월)`; }
    else { amount = bill; date = stmtDate || useDate; tag = ` (할부 ${round}/${months}회차)`; }
    const st = `${get(r, 'status')} ${statement ? '' : get(r, 'plan')}`;
    if (useDate && /취소|거절|승인거절|환불/.test(st)) { cancelled++; return; }
    // 해외 이용: 원화 금액이 아직 없고 달러 금액만 있는 줄 (원화는 명세서에서 확정)
    if (useDate && !amount && money(get(r, 'foreign')) > 0) { foreign++; return; }
    if (!useDate || !amount) { if (r.some(x => String(x ?? '').trim())) skipped++; return; }
    if (amount < 0) { cancelled++; return; }
    billTotal += bill;
    // 중복 방지 key: 승인번호, 없으면 이용일·금액·가맹점(할부 청구분은 회차까지)
    // 같은 날 같은 곳에서 같은 금액을 여러 번 쓴 경우는 #2, #3 … 으로 구분 (같은 파일을 다시 올려도 같은 key)
    const appr = String(get(r, 'approval') || '').trim();
    const base = `${company}|${appr || `${useDate}|${inst && installment !== 'use' ? `${money(get(r, 'amount'))}|${round}` : amount}|${merchant}`}`;
    used[base] = (used[base] || 0) + 1;
    if (inst && installment === 'use' && used[base] > 1) return;
    const key = used[base] > 1 ? `${base}#${used[base]}` : base;
    items.push({ key, date, ...(months > 1 ? { inst: { months, ...(inst && installment !== 'use' && round ? { round } : {}) } } : {}), time: date === useDate ? cardTime(get(r, 'date'), get(r, 'time')) : '', amount: Math.round(amount), merchant: merchant + tag, cat: guess(merchant), card: String(get(r, 'card') || '').trim(), plan: String(get(r, 'plan') || '').trim() });
  });
  return { company, statement, billTotal: Math.round(billTotal), stmtDate, items, cancelled, skipped, foreign, fileTotal: summaryTotal(rows.slice(0, i)) };
}

/** 머리글 위 요약 칸에서 파일이 적어 둔 국내 정상 이용 합계 읽기
    (KB국민카드 승인내역: "정상/취소 (금액)" · "국내" · "417,776 / 0") → 숫자 또는 null */
function summaryTotal(top) {
  for (const r of top) {
    const cells = r.map(x => String(x ?? '').replace(/\s+/g, ''));
    const j = cells.findIndex(x => /정상/.test(x) && /금액/.test(x));
    if (j < 0) continue;
    const k = cells.findIndex((x, n) => n > j && x === '국내');
    const v = cells.slice((k >= 0 ? k : j) + 1).find(x => /\d/.test(x));
    if (v) return money(v.split('/')[0]);
  }
  return null;
}

/** 지출 내역에 합치기: 이미 있는 key 는 건너뛰고, 처음 가져올 때 예시 지출은 지운다
    importId 를 붙여 두면 반영 기록 단위로 한꺼번에 취소할 수 있다 → { fin, add(새 지출 목록), added, dup, removedExamples } */
export function mergeCard(fin, { company, items }, uid, importId) {
  const real = fin.expenses.filter(e => !/\(예시\)$/.test(e.memo || ''));
  const have = new Set(real.map(e => e.cardKey).filter(Boolean));
  const add = items.filter(x => !have.has(x.key)).map(x => ({ id: uid(), date: x.date, ...(x.time ? { time: x.time } : {}), ...(x.inst ? { inst: x.inst } : {}), amount: x.amount, cat: x.cat, memo: x.merchant, card: company, cardKey: x.key, ...(importId ? { importId } : {}) }));
  // 이미 있는 지출에 시간이 없으면 이번 파일의 이용 시간으로 채운다 (예전에 가져온 내역도 같은 파일을 다시 올리면 시간이 생김)
  // 이미 있는 지출에 시간 · 할부 정보가 없으면 이번 파일 것으로 채운다 (예전 내역도 같은 파일을 다시 올리면 생김)
  const timeOf = new Map(items.filter(x => x.time).map(x => [x.key, x.time]));
  const instMap = new Map(items.filter(x => x.inst).map(x => [x.key, x.inst]));
  let timed = 0;
  const kept = real.map(e => {
    const t = !e.time && e.cardKey && timeOf.get(e.cardKey), i = !e.inst && e.cardKey && instMap.get(e.cardKey);
    if (!t && !i) return e; timed++; return { ...e, ...(t ? { time: t } : {}), ...(i ? { inst: i } : {}) };
  });
  return { fin: { ...fin, expenses: [...kept, ...add] }, add, added: add.length, dup: items.length - add.length, removedExamples: fin.expenses.length - real.length, timed, times: Object.fromEntries(timeOf), insts: Object.fromEntries(instMap) };
}
