import { cardDate, cardTime } from './cardImport.js';

/* 월급통장 거래내역 파일 → 수입 내역 (개인 재무 › 수입관리)
   - 은행 홈페이지·앱의 "거래내역 조회 → 엑셀(파일) 저장" 파일: .xls(옛 엑셀 또는 HTML 표) · .xlsx · .csv  (읽기는 cardImport.readTable)
   - 열은 머리글 이름으로 찾는다: 거래일(시) · 입금액(맡기신 금액) · 출금액 · 적요/내용/보낸분 · 잔액 · 구분
     입금 · 출금이 한 열(금액 + 구분)인 은행도 읽는다
   - 입금만 가져온다. 급여 표시 단어(예: 급여, 월급, 회사 이름)가 있으면 "급여", 상여 · 이자 · 환급은 그 분류, 나머지는 "기타"
   - 같은 줄은 한 번만: 날짜 · 시간 · 금액 · 내용 · 잔액으로 key (bankKey) */
const H = {
  date: /^(거래|입출금|처리|이체)?(일자|일시|날짜|일)$|거래일|거래 ?일시|^날짜$/,
  time: /(거래)?시간|시각/,
  deposit: /입금|맡기신|받은 ?금액|입금액/,
  withdraw: /출금|찾으신|보낸 ?금액|지급/,
  amount: /^(거래 ?)?금액$/,
  kind: /^구분$|거래 ?구분|입출 ?구분/,
  memo: /적요|내용|기재|보낸 ?분|받는 ?분|의뢰인|거래처|메모|입금자|상대/,
  balance: /잔액|잔고/,
};
const BAD = { deposit: /자|명|처|은행|계좌|후|잔액|이자율/, withdraw: /자|명|처|은행|계좌|후|잔액/, memo: /번호|코드/ };
const money = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0);

function findHeader(rows) {
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const h = (rows[i] || []).map(x => String(x ?? '').replace(/\s+/g, ' ').trim());
    const col = k => h.findIndex(x => x && H[k].test(x.replace(/\s/g, '')) && !(BAD[k] && BAD[k].test(x)));
    const c = Object.fromEntries(Object.keys(H).map(k => [k, col(k)]));
    // 내용 열이 여러 개면(보낸분 · 적요 · 메모) 모두 모아 "보낸 사람 → 적요 → 메모" 순서로 붙인다
    const who = /보낸|의뢰인|입금자|상대|거래처/, memoCols = h.map((x, k) => [x.replace(/\s/g, ''), k])
      .filter(([x, k]) => x && H.memo.test(x) && !BAD.memo.test(x) && ![c.date, c.deposit, c.withdraw, c.amount, c.kind, c.balance, c.time].includes(k))
      .sort((a, b) => (who.test(b[0]) - who.test(a[0])) || (/메모/.test(a[0]) - /메모/.test(b[0])) || a[1] - b[1]).map(([, k]) => k);
    if (c.date >= 0 && (c.deposit >= 0 || (c.amount >= 0 && c.kind >= 0))) return { i, c, memoCols };
  }
  return null;
}

/** 분류 정하기: 급여 표시 단어 → 급여, 그 밖의 흔한 입금 */
export function guessIncome(text, salaryWords = []) {
  const t = String(text || '');
  if (salaryWords.some(w => w && t.includes(w))) return '급여';
  if (/급여|월급|임금|봉급|salary/i.test(t)) return '급여';
  if (/상여|보너스|성과급|인센티브/.test(t)) return '상여';
  if (/이자|배당|결산/.test(t)) return '이자·배당';
  if (/환급|환불|국세|지방세/.test(t)) return '환급';
  return '기타';
}
export const parseWords = s => String(s || '').split(/[,，\n]/).map(x => x.trim()).filter(Boolean);

/** 표 → { items: [{ key, date, time, amount, source, cat }], withdraws, skipped } */
export function parseBankRows(rows, { bank = '은행', year = new Date().getFullYear(), salaryWords = [], onlySalary = false } = {}) {
  const found = findHeader(rows);
  if (!found) throw new Error('거래일 · 입금액 머리글을 찾지 못했습니다. 은행 거래내역 엑셀 파일인지 확인해 주세요');
  const { i, c, memoCols } = found;
  const get = (r, k) => (c[k] >= 0 ? r[c[k]] ?? '' : '');
  const items = [], used = {};
  let withdraws = 0, skipped = 0, others = 0;
  rows.slice(i + 1).forEach(r => {
    if (!r.some(x => String(x ?? '').trim())) return;
    const date = cardDate(get(r, 'date'), year);
    if (!date) { skipped++; return; }
    let amount = c.deposit >= 0 ? money(get(r, 'deposit')) : 0;
    if (c.deposit < 0) { const k = String(get(r, 'kind')); amount = /입금|받|이자/.test(k) ? money(get(r, 'amount')) : 0; }
    if (!(amount > 0)) { withdraws++; return; }
    const parts = memoCols.map(k => String(r[k] ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const source = [...new Set(parts)].join(' · ') || '입금';
    const cat = guessIncome(source, salaryWords);
    if (onlySalary && cat !== '급여' && cat !== '상여') { others++; return; }
    const time = cardTime(get(r, 'date'), get(r, 'time'));
    const base = `${bank}|${date}|${time}|${amount}|${source}|${money(get(r, 'balance'))}`;
    used[base] = (used[base] || 0) + 1;
    items.push({ key: used[base] > 1 ? `${base}#${used[base]}` : base, date, time, amount: Math.round(amount), source, cat });
  });
  return { items, withdraws, skipped, others };
}

/** 수입 내역에 합치기: 이미 있는 bankKey 는 건너뜀 → { add, dup } */
export function mergeBank(incomes, items, uid, importId, bank) {
  const have = new Set((incomes || []).map(e => e.bankKey).filter(Boolean));
  const add = items.filter(x => !have.has(x.key)).map(x => ({ id: uid(), date: x.date, ...(x.time ? { time: x.time } : {}), amount: x.amount, cat: x.cat, source: x.source, memo: bank, bankKey: x.key, importId }));
  return { add, dup: items.length - add.length };
}
