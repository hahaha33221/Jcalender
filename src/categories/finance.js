import { ROWS, iso } from '../data.js';

/* 개인 재무: 지출 내역과 구매해야 할 물품
   finance = {
     budget: 월 변동지출 예산(원),
     expenses: [{ id, date, amount, cat, memo, shopId? }],   shopId 가 있으면 구매 목록에서 온 지출
     shopping: [{ id, name, qty, price(예상), cat, added, bought?: 'YYYY-MM-DD', paid?: 실제 금액 }],
   } */
export const EXP_CATS = ['식비', '생활용품', '교통', '여가', '선물', '의료', '기타'];
export const won = n => `${Math.round(n || 0).toLocaleString()}원`;
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
