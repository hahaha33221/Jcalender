import { ROWS, iso } from '../data.js';

/* 개인 재무: 지출 내역과 구매해야 할 물품
   finance = {
     budget: 월 변동지출 예산(원),
     expenses: [{ id, date, amount, cat, memo, shopId? }],   shopId 가 있으면 구매 목록에서 온 지출
     shopping: [{ id, name, qty, price(예상), cat, added, bought?: 'YYYY-MM-DD', paid?: 실제 금액 }],
   } */
export const EXP_CATS = ['식비', '생활용품', '교통', '여가', '선물', '의료', '기타'];
/* 지출 카테고리 설정 finance.cats = [{ name, budget(월 한도, 0 = 없음), keywords(포함 범위: 가맹점·메모에 이 말이 있으면 이 분류) }]
   '기타' 는 어디에도 안 맞는 지출이 가는 곳이라 지울 수 없다 */
export const OTHER = '기타';
export const DEFAULT_KEYWORDS = {
  식비: ['스타벅스', '커피', '카페', '투썸', '이디야', '빽다방', '배달', '요기요', '쿠팡이츠', '배민', '우아한', '편의점', 'GS25', '씨유', '세븐일레븐', '이마트24', '베이커리', '파리바게', '뚜레쥬르', '버거', '맥도날드', '롯데리아', '치킨', '피자', '김밥', '식당', '분식', '국밥', '고기', '횟집', '푸드', '음식', '레스토랑', '주점', '호프', '점심', '저녁'],
  생활용품: ['다이소', '올리브영', '쿠팡', '이마트', '홈플러스', '롯데마트', '코스트코', '트레이더스', '마트', '11번가', 'G마켓', '옥션', 'SSG', '무신사', '이케아', 'IKEA', '생활'],
  교통: ['택시', '카카오T', '버스', '지하철', '철도', '코레일', 'KTX', 'SRT', '티머니', '주유', '주차', '하이패스', '고속도로', '항공', '쏘카', 'SK에너지', 'GS칼텍스', 'S-OIL', '오일'],
  여가: ['CGV', '메가박스', '롯데시네마', '영화', '넷플릭스', 'NETFLIX', '유튜브', 'YOUTUBE', '멜론', '스포티파이', '티빙', '웨이브', '왓챠', '디즈니', '노래', '볼링', 'PC방', '헬스', '필라테스', '골프', '여행', '호텔', '숙박', '야놀자', '여기어때', '에어비앤비', '공연', '티켓', '인터파크', '교보', 'YES24', '알라딘', '서점'],
  선물: ['꽃', '플라워', '선물', '기프트'],
  의료: ['병원', '의원', '약국', '치과', '한의원', '안과', '피부과', '정형외과', '내과', '소아과', '검진', '메디'],
  기타: [],
};
export const defaultCats = () => EXP_CATS.map(name => ({ name, budget: 0, keywords: [...(DEFAULT_KEYWORDS[name] || [])] }));
/** 지금 쓰는 카테고리 목록 (설정 전이면 기본값) */
export const catsOf = f => (f?.cats?.length ? f.cats : defaultCats());
/** 가맹점·메모로 분류 추측: 포함 범위(키워드)가 먼저 맞는 카테고리, 없으면 기타 */
export function guessCatBy(cats, text) {
  const t = String(text || '').toLowerCase();
  const hit = cats.find(c => c.name !== OTHER && (c.keywords || []).some(k => k && t.includes(k.toLowerCase())));
  return hit ? hit.name : (cats.find(c => c.name === OTHER) ? OTHER : cats[cats.length - 1]?.name || OTHER);
}
export const won = n => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const uid = () => Math.random().toString(36).slice(2, 10);

// 오늘 지출을 기록하면 일일체크의 "지출 입력"을 완료한다
export const ACT_EXPENSE = ROWS.find(r => r.a === 'P' && r.c === 'D' && r.action === '지출 입력');

export function seedFinance(today = new Date()) {
  const d = n => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
  const monthStart = today.getDate() - 1;          // 이번 달 안의 날짜만 쓰도록 자른다
  const at = n => d(Math.min(n, monthStart));
  return {
    budget: 1200000,
    expenses: [
      { id: 'e1', date: at(1), amount: 12800, cat: '식비', memo: '점심 (예시)' },
      { id: 'e2', date: at(2), amount: 54000, cat: '생활용품', memo: '마트 장보기 (예시)' },
      { id: 'e3', date: at(3), amount: 1400, cat: '교통', memo: '버스 (예시)' },
      { id: 'e4', date: at(5), amount: 36000, cat: '여가', memo: '영화 (예시)' },
      { id: 'e5', date: at(7), amount: 24500, cat: '식비', memo: '저녁 외식 (예시)' },
      { id: 'e6', date: at(9), amount: 18000, cat: '의료', memo: '약국 (예시)' },
      { id: 'e7', date: at(12), amount: 68000, cat: '식비', memo: '장보기 (예시)' },
      { id: 'e8', date: at(15), amount: 45000, cat: '교통', memo: '교통카드 충전 (예시)' },
    ],
    shopping: [
      { id: 's1', name: '어머니 생신 선물 (예시)', qty: 1, price: 80000, cat: '선물', added: d(2) },
      { id: 's2', name: '세탁 세제 (예시)', qty: 1, price: 15900, cat: '생활용품', added: d(1) },
      { id: 's3', name: '우유·계란 (예시)', qty: 2, price: 9800, cat: '식비', added: d(0) },
      { id: 's4', name: '두루마리 휴지 (예시)', qty: 1, price: 21900, cat: '생활용품', added: d(3) },
    ],
  };
}

/* ── 상태 변경 함수 (finance → 새 finance) ── */
export const addShop = (f, item) => ({ ...f, shopping: [...f.shopping, { id: uid(), qty: 1, ...item }] });
export const delShop = (f, id) => ({ ...f, shopping: f.shopping.filter(s => s.id !== id) });

/** 구매 완료: 물품에 구매일·금액을 적고 같은 금액의 지출을 만든다 */
export function buyShop(f, id, paid, date) {
  const s = f.shopping.find(x => x.id === id);
  if (!s) return f;
  return {
    ...f,
    shopping: f.shopping.map(x => (x.id === id ? { ...x, bought: date, paid } : x)),
    expenses: [...f.expenses.filter(e => e.shopId !== id), { id: uid(), date, amount: paid, cat: s.cat, memo: `${s.name}${s.qty > 1 ? ` ×${s.qty}` : ''}`, shopId: id }],
  };
}
/** 구매 취소: 구매 목록으로 되돌리고 연결된 지출을 지운다 */
export const unbuyShop = (f, id) => ({
  ...f,
  shopping: f.shopping.map(x => (x.id === id ? { ...x, bought: undefined, paid: undefined } : x)),
  expenses: f.expenses.filter(e => e.shopId !== id),
});
export const addExpense = (f, e) => ({ ...f, expenses: [...f.expenses, { id: uid(), ...e }] });
/** 지출 삭제. 구매 목록에서 온 지출이면 그 물품도 구매 전으로 되돌린다 */
export function delExpense(f, id) {
  const e = f.expenses.find(x => x.id === id);
  return e?.shopId ? unbuyShop(f, e.shopId) : { ...f, expenses: f.expenses.filter(x => x.id !== id) };
}
export const setExpenseCat = (f, id, cat) => ({ ...f, expenses: f.expenses.map(e => (e.id === id ? { ...e, cat } : e)) });

/* ── 지출 카테고리 편집 (finance → 새 finance) ── */
const withCats = (f, fn) => ({ ...f, cats: fn(catsOf(f).map(c => ({ ...c, keywords: [...(c.keywords || [])] }))) });
export const addCat = (f, name, budget = 0) => withCats(f, cs => (cs.some(c => c.name === name) ? cs : [...cs.filter(c => c.name !== OTHER), { name, budget, keywords: [] }, ...cs.filter(c => c.name === OTHER)]));
export const setCat = (f, name, patch) => withCats(f, cs => cs.map(c => (c.name === name ? { ...c, ...patch } : c)));
/** 이름 바꾸기: 지출·구매 목록의 분류도 함께 바꾼다 */
export function renameCat(f, from, to) {
  if (!to || from === to || from === OTHER || catsOf(f).some(c => c.name === to)) return f;
  const g = withCats(f, cs => cs.map(c => (c.name === from ? { ...c, name: to } : c)));
  return { ...g, expenses: g.expenses.map(e => (e.cat === from ? { ...e, cat: to } : e)), shopping: g.shopping.map(s => (s.cat === from ? { ...s, cat: to } : s)) };
}
/** 삭제: 그 분류의 지출·구매 목록은 기타로 옮긴다 */
export function delCat(f, name) {
  if (name === OTHER) return f;
  const g = withCats(f, cs => { const r = cs.filter(c => c.name !== name); return r.some(c => c.name === OTHER) ? r : [...r, { name: OTHER, budget: 0, keywords: [] }]; });
  return { ...g, expenses: g.expenses.map(e => (e.cat === name ? { ...e, cat: OTHER } : e)), shopping: g.shopping.map(s => (s.cat === name ? { ...s, cat: OTHER } : s)) };
}
export const moveCat = (f, name, d) => withCats(f, cs => { const i = cs.findIndex(c => c.name === name), j = i + d; if (i < 0 || j < 0 || j >= cs.length) return cs; const r = [...cs]; [r[i], r[j]] = [r[j], r[i]]; return r; });
/** 카드에서 가져온 지출에 지금 포함 범위를 다시 적용 → { f, changed } */
export function reapplyCats(f) {
  const cats = catsOf(f);
  let changed = 0;
  const expenses = f.expenses.map(e => { if (!e.cardKey) return e; const c = guessCatBy(cats, e.memo); if (c !== e.cat) changed++; return c === e.cat ? e : { ...e, cat: c }; });
  return { f: { ...f, expenses }, changed };
}
