/* 목표 추천 (AI 없이 규칙으로): 온보딩 답(관심 주제 · 지금 수준 · 쓸 수 있는 시간)과 기간으로 목표 · 마일스톤 · 작업을 만든다
   추천 하나 = { topic, cat, name, why, miles: [[이름, 기간 비율 0~1]], tasks: [[이름, 시작 비율, 끝 비율]] }
   ctx = { days, months, level: 0 처음 · 1 조금 · 2 꾸준히, hours: 0 주 1~2시간 · 1 3~5시간 · 2 6시간 이상 } */
const r = n => Math.max(1, Math.round(n));
/** 기간을 n 번 나눈 점검 시점 (마지막은 기간 끝) */
const checks = (ctx, label) => {
  const n = ctx.months >= 6 ? 3 : ctx.months >= 2 ? 2 : 1;
  return Array.from({ length: n }, (_, i) => [n === 1 ? `${label} 최종 점검` : i === n - 1 ? `${label} 최종 점검` : `${label} 중간 점검 ${i + 1}`, (i + 1) / n]);
};
const per = ctx => (ctx.months <= 1 ? '이번 달' : `${ctx.months}개월`);

export const LEVELS = [['처음 시작해요', '아직 해 본 적이 거의 없음'], ['조금 해 봤어요', '가끔 하거나 하다 말았음'], ['꾸준히 하는 중', '이미 습관이 있고 더 올리고 싶음']];
export const HOURS = [['주 1~2시간', '틈틈이'], ['주 3~5시간', '하루 30분~1시간'], ['주 6시간 이상', '시간을 꽤 쓸 수 있음']];

export const GOAL_TOPICS = [
  /* ── 개인 ── */
  { id: 'fit', a: 'P', name: '운동 · 체력', desc: '러닝 · 헬스 · 걷기', cat: '건강 관리', make: c => [{
    name: c.level === 0 ? `주 ${c.hours ? 3 : 2}회 30분 운동 습관 만들기` : c.level === 1 ? `5km ${c.months >= 3 ? 30 : 35}분 안에 달리기` : c.months >= 6 ? '하프 마라톤 완주하기' : '10km 60분 안에 달리기',
    why: c.level === 0 ? '처음엔 기록보다 횟수가 중요해요' : '지금 습관에서 한 단계 높은 기록',
    miles: [['운동 루틴 확정', 0.1], ...checks(c, '운동')], tasks: [['운동 종류 · 요일 정하기', 0, 0.08], ['운동 기록 남기기 (체크리스트)', 0, 1], ['중간 기록 측정', 0.45, 0.55]] }] },
  { id: 'weight', a: 'P', name: '체중 · 식단', desc: '감량 · 식습관', cat: '건강 관리', make: c => [{
    name: `체중 ${Math.min(8, r(c.months * (c.level === 2 ? 1 : 1.5)))}kg 감량하기`, why: '한 달 1~2kg 이 무리 없는 속도예요',
    miles: checks(c, '체중'), tasks: [['식단 · 체중 기록 시작', 0, 0.1], ['야식 · 간식 주 2회 이하', 0, 1], ['주 1회 체중 재기', 0, 1]] }] },
  { id: 'sleep', a: 'P', name: '수면 · 생활 리듬', desc: '일찍 자기 · 아침 루틴', cat: '건강 관리', make: c => [{
    name: `주 ${c.level === 2 ? 6 : 5}일 밤 ${c.level === 0 ? '12시' : '11시 30분'} 전에 잠들기`, why: '리듬이 잡히면 다른 목표도 쉬워져요',
    miles: checks(c, '수면'), tasks: [['잠들기 30분 전 휴대폰 끄기', 0, 1], ['아침 루틴 1개 정하기', 0, 0.2]] }] },
  { id: 'cert', a: 'P', name: '자격증 · 시험', desc: '시험 점수 · 자격증 취득', cat: '자기계발/학습', make: c => [{
    name: c.months >= 3 ? '목표 자격증 취득 (시험 응시)' : '자격증 이론 1회독 끝내기', why: `${per(c)} 동안 주 ${['1~2', '3~5', '6+'][c.hours]}시간 기준`,
    miles: c.months >= 3 ? [['교재 1회독', 0.45], ['모의고사 3회', 0.8], ['시험 응시', 1]] : [['이론 절반', 0.5], ['이론 1회독', 1]],
    tasks: [['시험 일정 · 교재 정하기', 0, 0.05], ['매일 공부 기록 (체크리스트)', 0, 1], ...(c.months >= 3 ? [['기출 · 모의고사 풀기', 0.5, 0.95]] : [])] }] },
  { id: 'read', a: 'P', name: '독서', desc: '책 읽기 · 정리', cat: '자기계발/학습', make: c => [{
    name: `책 ${r(c.months * [1, 2, 3][c.hours] * (c.level ? 1 : 0.7))}권 읽기`, why: `한 달 ${[1, 2, 3][c.hours]}권 정도 속도`,
    miles: checks(c, '독서'), tasks: [['읽을 책 목록 만들기', 0, 0.05], ['하루 20쪽 읽기', 0, 1], ['한 권마다 한 줄 정리', 0, 1]] }] },
  { id: 'lang', a: 'P', name: '외국어', desc: '영어 · 회화 · 단어', cat: '자기계발/학습', make: c => [{
    name: c.level === 0 ? `매일 영어 ${c.hours ? 30 : 15}분 · 단어 ${r(c.days * (c.hours ? 10 : 5) / 10) * 10}개 외우기` : c.level === 1 ? '영어로 5분 자기소개 · 일상 대화하기' : '영어 시험 목표 점수 달성',
    why: '말하기 · 듣기는 매일 조금씩이 가장 빨라요', miles: checks(c, '외국어'), tasks: [['교재 · 앱 정하기', 0, 0.05], ['매일 공부 (체크리스트)', 0, 1], ['말하기 녹음해 보기', 0.4, 1]] }] },
  { id: 'save', a: 'P', name: '돈 모으기', desc: '저축 · 비상금', cat: '개인 재무', make: c => [{
    name: `${r(c.months * [30, 50, 100][c.level])}만원 모으기`, why: `한 달 ${[30, 50, 100][c.level]}만원씩 (수입에 맞게 고치세요)`,
    miles: checks(c, '저축'), tasks: [['월급날 자동이체 설정', 0, 0.05], ['매달 저축액 확인', 0, 1]] }] },
  { id: 'spend', a: 'P', name: '지출 줄이기', desc: '예산 · 고정비 · 구독', cat: '개인 재무', make: c => [{
    name: `한 달 지출 ${[10, 15, 20][c.level]}% 줄이기`, why: '고정비부터 보면 가장 쉽게 줄어요',
    miles: checks(c, '지출'), tasks: [['안 쓰는 구독 · 고정비 정리', 0, 0.15], ['한 달 예산 정하기', 0, 0.1], ['매주 지출 확인', 0, 1]] }] },
  { id: 'hobby', a: 'P', name: '취미 · 여행', desc: '여행 · 문화생활 · 취미', cat: '여가 관리', make: c => [{
    name: c.months >= 6 ? '여행 2번 · 새 취미 1개 시작하기' : c.months >= 3 ? '가까운 여행 1번 다녀오기' : '이번 달 문화생활 2번 하기',
    why: '쉬는 계획도 목표로 잡아야 지켜져요', miles: checks(c, '여가'), tasks: [['가고 싶은 곳 · 하고 싶은 것 목록', 0, 0.1], ['날짜 정하고 예약', 0.1, 0.4]] }] },
  { id: 'journal', a: 'P', name: '기록 · 회고', desc: '일기 · 주간 회고', cat: '저널링', make: c => [{
    name: `주간 회고 ${r(c.days / 7)}번 쓰기${c.level === 2 ? ' · 매일 한 줄 일기' : ''}`, why: '돌아보면 다음 목표가 보여요',
    miles: checks(c, '회고'), tasks: [['회고 양식 정하기', 0, 0.05], ['매주 일요일 회고', 0, 1]] }] },
  { id: 'people', a: 'P', name: '사람 · 관계', desc: '연락 · 가족 · 친구', cat: '인맥 관리', make: c => [{
    name: `소중한 사람 ${r(c.months * 3)}명에게 먼저 연락하기`, why: '한 달 3명이면 부담 없어요', miles: checks(c, '연락'), tasks: [['연락할 사람 목록 만들기', 0, 0.1], ['한 달에 한 번 가족 · 친구 만나기', 0, 1]] }] },
  /* ── 사업 ── */
  { id: 'sales', a: 'B', name: '매출 늘리기', desc: '월 매출 · 객단가', cat: '매출/매입', make: c => [{
    name: `월 매출 ${[10, 20, 30][c.level]}% 늘리기`, why: '지난 실적 대비 무리 없는 성장',
    miles: checks(c, '매출'), tasks: [['지난 3개월 매출 분석', 0, 0.1], ['매출 올릴 방법 3가지 정하기', 0.05, 0.2], ['주간 매출 점검', 0, 1]] }] },
  { id: 'customer', a: 'B', name: '신규 고객', desc: '고객 확보 · 재구매', cat: '고객 관리', make: c => [{
    name: `신규 고객 ${r(c.months * [5, 10, 20][c.hours])}명 확보하기`, why: '주에 쓸 수 있는 시간으로 계산했어요',
    miles: checks(c, '고객'), tasks: [['잠재 고객 목록 만들기', 0, 0.15], ['제안 · 연락 주 3건', 0.1, 1], ['기존 고객 재구매 제안', 0.3, 0.8]] }] },
  { id: 'launch', a: 'B', name: '상품 · 서비스 출시', desc: '새 상품 · 새 서비스', cat: '재고/상품', make: c => [{
    name: c.months >= 3 ? '새 상품(서비스) 1개 출시하기' : '새 상품 기획 · 샘플까지 만들기', why: '기획 → 제작 → 출시로 나눴어요',
    miles: c.months >= 3 ? [['상품 구성 확정', 0.3], ['샘플 완성', 0.65], ['출시', 1]] : [['기획 확정', 0.5], ['샘플 완성', 1]],
    tasks: [['시장 · 경쟁 조사', 0, 0.2], ['상품 구성 · 가격 정하기', 0.2, 0.35], ['제작 · 상세 페이지', 0.35, 0.85], ...(c.months >= 3 ? [['출시 홍보', 0.85, 1]] : [])] }] },
  { id: 'marketing', a: 'B', name: '마케팅 · 영업', desc: '홍보 · 문의 늘리기', cat: '마케팅/영업', make: c => [{
    name: `문의(상담) ${r(c.months * [10, 20, 40][c.hours])}건 받기`, why: '채널 2개에 집중하면 효과가 커요',
    miles: checks(c, '마케팅'), tasks: [['집중할 채널 2개 정하기', 0, 0.1], ['광고 · 홍보 실행', 0.1, 1], ['채널별 성과 비교', 0.5, 0.6]] }] },
  { id: 'content', a: 'B', name: '콘텐츠 발행', desc: '인스타 · 블로그 · 숏폼', cat: '콘텐츠 관리', make: c => [{
    name: `콘텐츠 ${r(c.days / 7 * [1, 2, 4][c.hours])}개 발행하기`, why: `주 ${[1, 2, 4][c.hours]}개 속도`, miles: checks(c, '콘텐츠'),
    tasks: [['콘텐츠 주제 목록 만들기', 0, 0.1], ['주간 발행 (콘텐츠 보드)', 0, 1], ['조회 · 반응 좋은 주제 정리', 0.5, 0.6]] }] },
  { id: 'cost', a: 'B', name: '비용 줄이기', desc: '고정비 · 매입 원가', cat: '사업 자금/투자', make: c => [{
    name: `고정비 ${[5, 10, 15][c.level]}% 줄이기`, why: '고정비 → 매입 원가 순서로', miles: checks(c, '비용'), tasks: [['고정비 · 매입 목록 정리', 0, 0.15], ['거래처 단가 다시 받기', 0.15, 0.5]] }] },
  { id: 'ops', a: 'B', name: '운영 체계화', desc: '업무 정리 · 매뉴얼', cat: '사업 할일/일정', make: c => [{
    name: `반복 업무 ${r(c.months * 2)}개 매뉴얼 · 자동화하기`, why: '사장님 시간을 벌어 주는 목표', miles: checks(c, '운영'), tasks: [['반복 업무 목록 만들기', 0, 0.15], ['매뉴얼 쓰기 · 맡기기', 0.15, 1]] }] },
  /* ── 근로 ── */
  { id: 'project', a: 'W', name: '핵심 프로젝트', desc: '맡은 프로젝트 완수', cat: '업무 할일/프로젝트', make: c => [{
    name: '핵심 프로젝트 기한 안에 마치기', why: '요구사항 → 진행 → 마무리로 나눴어요',
    miles: [['요구사항 확정', 0.2], ['중간 보고', 0.6], ['완료 · 결과 보고', 1]], tasks: [['요구사항 · 범위 정리', 0, 0.2], ['실행', 0.2, 0.85], ['마무리 · 회고', 0.85, 1]] }] },
  { id: 'wstudy', a: 'W', name: '직무 공부 · 자격증', desc: '업무 역량 · 자격증', cat: '목표 관리', make: c => [{
    name: c.months >= 3 ? '직무 자격증 취득 (시험 응시)' : `직무 강의 ${r(c.months * [2, 4, 6][c.hours])}개 듣기`, why: `주 ${['1~2', '3~5', '6+'][c.hours]}시간 기준`,
    miles: checks(c, '학습'), tasks: [['공부할 범위 · 교재 정하기', 0, 0.05], ['주간 공부 기록', 0, 1]] }] },
  { id: 'efficiency', a: 'W', name: '업무 효율', desc: '야근 줄이기 · 정리', cat: '업무 할일/프로젝트', make: c => [{
    name: `야근 주 ${c.level === 2 ? 1 : 2}회 이하로 줄이기`, why: '우선순위 정리부터', miles: checks(c, '효율'), tasks: [['매일 아침 할 일 3개 정하기', 0, 1], ['반복 업무 템플릿 만들기', 0.1, 0.4]] }] },
  { id: 'career', a: 'W', name: '커리어 · 이직', desc: '경력 정리 · 이직 준비', cat: '목표 관리', make: c => [{
    name: c.months >= 3 ? '경력기술서 완성 · 원하는 곳 지원하기' : '경력기술서 · 포트폴리오 정리하기', why: '정리 → 지원 순서',
    miles: c.months >= 3 ? [['경력기술서 완성', 0.4], ['지원 5곳', 0.8], ['면접', 1]] : [['경력 목록 정리', 0.5], ['경력기술서 완성', 1]],
    tasks: [['프로젝트 · 성과 목록 만들기', 0, 0.3], ['경력기술서 쓰기', 0.3, 0.6]] }] },
  { id: 'wdocs', a: 'W', name: '문서 · 지식 정리', desc: '업무 문서 · 노하우', cat: '업무 문서', make: c => [{
    name: `업무 노하우 문서 ${r(c.months * [2, 4, 6][c.hours])}개 정리하기`, why: '인수인계 · 내 성과 정리에 모두 쓰여요', miles: checks(c, '문서'), tasks: [['정리할 주제 목록', 0, 0.1], ['주 1개 정리', 0.1, 1]] }] },
];

/** 템플릿이 없는 카테고리의 기본 틀 (AI 추천을 권함) */
const generic = (cat, c) => [{
  name: `${cat === '목표 관리' ? '영역' : cat} ${c.months <= 1 ? '이번 달' : `${c.months}개월`} 목표 (이름을 내 말로 고쳐 주세요)`, why: '이 카테고리는 기본 틀만 있어요. 목표 이름을 고친 뒤 "AI 로 상세 To do 받기"를 추천해요',
  miles: checks(c, '목표'), tasks: [['지금 상태 점검 · 목표 숫자 정하기', 0, 0.1], ['주간 실행', 0.1, 1], ['중간 점검 · 계획 조정', 0.45, 0.55]] }];
/** 카테고리(상세 내용)를 골라서 추천: sel = [{ cat, topics: [주제 id] }], target(cat) = 목표를 저장할 카테고리 */
export const topicsOfCat = (area, cat) => GOAL_TOPICS.filter(t => t.a === area && t.cat === cat);
export function recommendByCats(area, sel, ctx, target) {
  return sel.flatMap(({ cat, topics }) => {
    const ts = topicsOfCat(area, cat).filter(t => topics.includes(t.id));
    const list = ts.length ? ts.flatMap(t => t.make(ctx).map((g, i) => ({ ...g, key: `${cat}|${t.id}-${i}`, topicName: t.name })))
      : generic(cat, ctx).map((g, i) => ({ ...g, key: `${cat}|g-${i}`, topicName: '기본 틀', generic: true }));
    return list.map(g => ({ ...g, srcCat: cat, cat: target(cat) }));
  });
}
/** 고른 주제들로 추천 목록 */
export function recommend(area, topics, ctx, okCat) {
  return GOAL_TOPICS.filter(t => t.a === area && topics.includes(t.id)).flatMap(t => t.make(ctx).map((g, i) => ({ ...g, key: `${t.id}-${i}`, topic: t.id, topicName: t.name, cat: okCat(t.cat) ? t.cat : '목표 관리' })));
}
