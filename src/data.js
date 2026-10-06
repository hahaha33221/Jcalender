export const RAW = `
#P|D
목표 관리|전체 액션 목표|목표 설정|I|지난 기록으로 달성 가능한 목표 수치를 제안
||기간별 관리|I|기간별 진행률을 한 문장으로 요약
|체크리스트|루틴 완료 체크|N|직접 체크
|알람|지정 시각 알림|A|푸시 알림 API로 정해진 시각에 발송
건강 관리|운동|운동 기록|A|헬스 데이터 API(Apple 건강, Health Connect 등)로 종류와 시간을 자동 수집
|수면|수면 기록|A|웨어러블 헬스 API로 취침·기상 시각을 자동 수집
|식단|끼니 기록|I|음식 사진에서 메뉴와 칼로리를 추정
|병원·검진|병원 예약|A|캘린더 API로 예약 일정을 등록
||예약 후 준비(온보딩)|I|진료·검진 종류별 준비물과 주의사항 목록을 생성
자기계발/학습|영어|공부 시간 기록|A|타이머·학습 앱 연동으로 시간을 자동 집계
||공부 내용 기록|I|기록한 내용에서 복습 문제를 생성
개인 재무|가계부|수입 입력|A|마이데이터 API로 입금 내역을 자동 수집
||지출 입력|A|카드·계좌 내역을 자동 수집
|개인 자산|잔액 갱신|A|계좌·증권 잔액을 자동 조회
|고정지출 관리|고정지출 확인|I|결제 내역에서 매달 반복되는 결제를 자동 식별
||결제일 알림 (제안)|A|푸시 알림 API로 결제 전날 발송
|변동지출 관리|변동지출 입력|I|지출 내역을 분류(식비, 여가비 등)로 자동 지정
||예산 대비 사용액 확인 (제안)|I|이번 달 초과가 예상되면 미리 안내
#P|S
개인 일정/캘린더|일정|일정 등록|A|캘린더 API로 양방향 동기화
||다음 일정 확인|I|다가오는 일정을 아침에 한 줄로 요약
기념일 관리|생일·기념일|기념일 등록|A|연락처·캘린더 API에서 생일과 기념일을 가져옴
||기념일 알림 (제안)|A|푸시 알림 API로 며칠 전 발송
인맥 관리|명함 관리|명함 등록|I|명함 사진에서 이름·회사·연락처를 추출
||만남 메모 기록 (제안)|I|음성 메모를 텍스트로 변환
개인 재무|개인 자산|잔액 갱신|A|계좌·증권 잔액을 자동 조회
#P|W
건강 관리|수면|취침·기상 기록|N|일일체크의 수면 기록을 재사용
||주간 평균 확인|I|지난주와 비교해 변화를 요약
여가 관리|여행|여행 일정 연동|A|'오장' 앱 API로 일정을 가져옴
||여행 비용 연동|A|'오장' 앱 API로 비용을 가져옴
||여행 앨범 연동|A|'오장' 앱 API로 앨범을 가져옴
|독서|독서 기록 연동|A|'주경야독' 앱 API로 기록을 가져옴
|기타|악보 연동|A|'악보나라' 앱 API로 기록을 가져옴
|밴드합주|합주 연동|A|'악보나라' 앱 API로 합주 기록을 가져옴
저널링|주간 회고|한 주 돌아보고 적기|I|한 주 기록을 모아 회고 초안을 생성
#P|M
개인 목표 관리|건강 목표|진행 점검|A|헬스 데이터로 목표 대비 수치를 자동 계산
|관계 목표|진행 점검|I|연락 기록에서 소홀했던 관계를 안내
|성장 목표|진행 점검|I|학습 기록으로 달성 예상 시점을 추정
습관/루틴 관리|습관·루틴|달성률 확인|N|기록을 앱에서 자동 집계
||조정 결정|I|달성률을 보고 조정안을 제안
개인 재무|개인 자산|월간 잔액 점검 (제안)|I|전월 대비 변화를 요약
#P|Y
건강 관리|병원·검진|검진 예약 등록|A|캘린더 API로 일정에 등록
||결과 메모|I|결과지 사진에서 주요 수치를 추출
#B|D
목표 관리|전체 액션 목표|목표 설정|I|지난 실적으로 달성 가능한 목표를 제안
||기간별 관리|I|기간별 진행률을 요약
|체크리스트|개점 체크|N|직접 체크
||마감 체크|N|직접 체크
|알람|업무 마감 알림|A|푸시 알림 API로 발송
||입금 예정일 알림|A|푸시 알림 API로 발송
||문의 응답 기한 알림|A|푸시 알림 API로 발송
매출/매입|매출|입금 입력|A|계좌·결제대행(PG) 정산 API로 자동 수집
|매입|지출 입력|A|법인·사업용 카드 내역을 자동 수집
고객 관리|신규 문의|문의 등록|A|메일·메신저·문의 폼에서 자동 수집
||문의 응답|I|답변 초안을 작성
사업 할일/일정|할일|오늘 할일 확인|I|우선순위를 제안
||완료 체크|N|직접 체크
|일정|오늘 일정 확인|A|캘린더 API로 동기화
마케팅/영업|활동 기록|활동 메모|I|음성 메모를 정리된 문장으로 변환
||반응 기록|A|SNS·광고 채널 지표를 자동 조회
#B|S
프로젝트/외주|요청|신규 요청 접수|I|요청 내용에서 범위·기한·금액을 추출
||단계 이동|A|협업 도구의 상태와 동기화
||변경 사항 기록|I|대화 내용에서 변경점을 요약
고객 관리|상담|단계 이동|I|상담 내용으로 다음 단계를 제안
||후속 일정 등록|A|캘린더 API로 등록
재고/상품|입출고|입고 수량 갱신|A|재고 시스템·발주 데이터로 갱신
||출고 수량 갱신|A|쇼핑몰 주문 API로 자동 차감
계약서/문서|계약|문서 등록|A|클라우드 저장소 API로 파일 보관
||만료일 입력|I|계약서에서 만료일과 갱신일을 추출
파트너/거래처|연락처|연락처 등록|I|명함 사진에서 정보를 추출
||마지막 연락일 갱신|A|메일·메신저 이력에서 자동 갱신
사업 자금/투자|자금 이동|입출금 기록|A|계좌 내역을 자동 수집
||투자·대출 기록|N|직접 입력
사업 일정/캘린더|미팅|일정 등록|A|캘린더 API로 동기화
||다음 일정 확인|I|미팅 전 상대와의 이력을 요약
#B|W
고객 관리|파이프라인|정체 건 확인|I|오래 머문 건을 자동 탐지
||후속 연락 대상 선정|I|연락할 대상을 추천
프로젝트/외주|진행|지연 위험 확인|I|기한 대비 진행률로 위험 건을 표시
||기한·금액 갱신|N|직접 입력
||다음 주 계획|I|계획 초안을 생성
재고/상품|부족 품목|부족 시점 확인|I|판매 속도로 소진 시점을 예측
||발주|A|공급처 발주 시스템으로 주문
콘텐츠 관리|발행|단계 정리|N|아이디어·제작·예약·발행 상태를 직접 갱신
||다음 주 발행 계획|I|발행 일정 초안을 생성
||예약 발행|A|SNS 예약 발행 API로 등록
마케팅/영업|주간 성과|채널 지표 수집|A|분석 도구 API로 유입·문의 수치를 조회
||성과 요약|I|한 주 변화를 요약
매출/매입|미수·미지급|받을 돈 확인|A|입금 내역과 청구서를 대조해 미수를 식별
||줄 돈 확인|A|지급 예정 내역을 조회
리뷰/회고|주간 회고|한 주 돌아보기|I|회고 초안을 생성
#B|M
매출/매입|월 마감|매출·매입 합산|N|앱에서 자동 집계
||수지 확인|I|전월 대비 변화를 요약
사업 자금/투자|자금 흐름|잔액 확인|A|계좌 잔액을 자동 조회
||현금흐름 점검|I|향후 3개월 자금 흐름을 예측
사업 목표 관리|지표|지표 갱신|A|판매·방문 지표를 자동 조회
||진행률 확인|I|미달 원인을 요약
세금/정산|세금계산서|발행 확인|A|전자세금계산서 서비스에서 발행 내역을 조회
||수취 확인|A|전자세금계산서 서비스에서 수취 내역을 조회
|증빙|증빙 정리|I|영수증 사진을 분류하고 정리
프로젝트/외주|정산|외주비 지급|A|이체·정산 서비스로 지급
||대금 수금 확인|A|입금 내역과 청구서를 대조
파트너/거래처|거래 대조|정산 금액 대조|I|두 내역의 차이를 찾아 표시
재고/상품|실사|실사 수량 입력|N|직접 입력
||차이 확인|I|큰 차이의 원인을 추정
마케팅/영업|월 성과|채널별 성과 비교|I|채널별 효율을 요약
#B|Y
세금/정산|신고|신고 자료 수집|A|회계·세무 서비스에서 자료를 가져옴
||신고 일정 알림|A|푸시 알림 API로 발송
사업 목표 관리|연간 목표|연간 목표 수립|I|지난해 실적으로 초안을 생성
||분기 점검|I|분기별 달성 여부를 요약
계약서/문서|갱신|만료 예정 계약 확인|I|계약서에서 만료일을 추출해 목록화
||인허가·보험 갱신 알림|A|푸시 알림 API로 발송
사업 자금/투자|자금 계획|연간 자금 계획 수립|I|지난해 흐름으로 초안을 생성
|투자 성과|수익률 확인|A|증권 계좌 API로 수익률을 조회
파트너/거래처|거래 재검토|조건 재협상|I|협상 포인트 초안을 작성
||거래처 평가|I|거래 이력으로 평가를 요약
콘텐츠 관리|연간 계획|연간 계획 수립|I|지난해 성과로 계획 초안을 생성
#W|D
목표 관리|전체 액션 목표|목표 설정|I|지난 실적으로 달성 가능한 목표를 제안
||기간별 관리|I|기간별 진행률을 요약
|체크리스트|출근 후 체크|N|직접 체크
||퇴근 전 체크|N|직접 체크
|알람|업무 마감 알림|A|푸시 알림 API로 발송
||회의 시작 알림|A|캘린더 API 연동으로 발송
||보고 기한 알림|A|푸시 알림 API로 발송
업무 할일/프로젝트|할일|오늘 우선순위 정하기|I|마감·중요도로 순서를 제안
||완료 체크|N|직접 체크
회의/업무 일정|회의|오늘 회의 확인|A|캘린더 API로 동기화
||결정 사항 메모|I|회의 녹음을 텍스트로 변환해 요약
근태|출퇴근|출근 기록|A|근태·출입 시스템에서 자동 수집
||퇴근 기록|A|근태·출입 시스템에서 자동 수집
|초과근무|초과근무 기록|A|근태 데이터로 자동 계산
성과 기록|오늘의 성과|성과 한 줄 기록|I|완료한 할일에서 성과 문장 초안을 생성
직무 학습|학습|학습 시간 기록|A|타이머·학습 서비스 연동으로 자동 집계
||학습 내용 기록|I|기록한 내용에서 복습 문제를 생성
#W|S
회의/업무 일정|일정|일정 등록|A|캘린더 API로 동기화
||다음 일정 확인|I|회의 전 안건과 이전 결정을 요약
업무 할일/프로젝트|요청|새 요청 등록|I|메일·메신저에서 요청 사항을 추출
||단계 갱신|A|업무 협업 도구의 상태와 동기화
업무 문서|보고서|보고서 등록|A|문서 저장소 API로 보관
||최신본 관리|A|문서 저장소의 버전 관리 기능 사용
|회의록|회의록 등록|I|회의 녹음에서 회의록 초안을 작성
업무 연락처|명함·연락처|연락처 등록|I|명함 사진이나 메일 서명에서 정보를 추출
||마지막 연락일 갱신|A|메일·메신저 이력에서 자동 갱신
업무 인맥/네트워킹|만남|만남 후 메모|I|음성 메모를 정리된 문장으로 변환
근태|휴가|휴가 신청|A|인사 시스템으로 신청
||휴가 사용 기록|A|인사 시스템에서 사용 내역을 조회
기획·조사|조사|조사 자료 정리|N|링크·메모를 자료 카드로 정리
#W|W
업무 할일/프로젝트|진행|지연 위험 확인|I|기한 대비 진행률로 위험 건을 표시
||기한 점검|A|캘린더·협업 도구에서 기한을 조회
||다음 주 계획|I|계획 초안을 생성
근태|주간 합계|근무시간 누적 확인|A|근태 시스템에서 조회
직무 학습|학습 합계|학습 시간 합계 확인|N|앱에서 자동 집계
||목표 대비 비교|I|부족한 시간을 안내
업무 인맥/네트워킹|연락 계획|이번 주 연락 대상 선정|I|연락할 대상을 추천
성과 기록·회고|주간 회고|한 주 돌아보기|I|회고 초안을 생성
기획·조사|기획|기획 진행 점검|N|상태·마감을 확인하고 다음 단계로 옮기기
#W|M
커리어 목표 관리|승진|진행률 갱신|I|요구 역량과 현재 역량의 차이를 정리
|스킬업|진행률 갱신|I|학습 기록으로 다음 학습을 추천
|이직|진행률 갱신|A|채용 공고 서비스에서 관련 공고를 조회
급여/복지|급여|급여 명세 확인|I|명세서 파일에서 항목별 금액을 추출
|복지|복지 포인트 잔액 확인|A|복지몰에서 잔액을 조회
||복지 사용 내역 확인|A|복지몰에서 사용 내역을 조회
근태|월 마감|근무일 합계 확인|A|근태 시스템에서 조회
||휴가 잔여 확인|A|인사 시스템에서 조회
||초과근무 합계 확인|A|근태 시스템에서 조회
직무 학습|월 학습|학습 결과 정리|I|한 달 기록을 요약
||자격증·교육 일정 점검|A|캘린더 API에 일정을 등록
업무 인맥/네트워킹|관계 점검|오래 연락 못한 사람 확인|I|연락 문구 초안을 함께 제안
업무 문서|정리|문서 정리|I|폴더·파일명 정리안을 제안
||문서 백업|A|클라우드 저장소로 자동 백업
기획·조사|회고|기획 회고|N|확정·보류된 기획을 돌아보기
#W|Y
성과 기록·회고|성과 리뷰|분기 리뷰 모으기|I|연간 성과를 요약
||연간 평가 자료 준비|I|평가 자료 초안을 생성
커리어 목표 관리|연간 목표|연간 목표 수립|I|지난해 성과로 초안을 생성
|연봉|협상 근거 준비|I|성과와 시장 자료를 정리해 초안을 작성
|이직 시장|시장 점검|A|채용 공고 서비스에서 공고를 조회
급여/복지|연말정산|공제 자료 수집|A|공제 자료 조회 서비스와 연동
|복지|소진 계획|I|잔여 복지 사용 계획을 제안
근태|연차|잔여 확인|A|인사 시스템에서 조회
||소멸 시점 알림|A|푸시 알림 API로 발송
직무 학습|연간 교육|교육 계획 수립|I|커리어 목표로 계획 초안을 생성
||자격증 갱신·시험 일정 등록|A|캘린더 API에 등록
업무 인맥/네트워킹|연간 정리|한 해 인맥 정리|I|연락 기록을 요약
||다음 해 계획|I|계획 초안을 생성
`;

export const AREAS = { P: { n: '개인', v: '--a1' }, B: { n: '사업', v: '--a2' }, W: { n: '근로', v: '--a3' } };
export const CYCLES = { D: '일일체크-루틴', S: '수시체크', W: '주간체크', M: '월간체크', Y: '년간체크' };
export const TY = { A: 'API', I: 'AI', N: '없음' };
export const ROWS = [];
/** 모든 줄 (숨김 포함, 카테고리 표를 만들 때 사용) */
export const ALL_ROWS = [];
/** 쓰지 않는 카테고리. 목록에서만 빼고, 다른 항목의 id(체크 기록)가 바뀌지 않도록 데이터 줄은 남겨 둔다 */
export const HIDDEN_CATS = new Set(['P|개인 일정/캘린더', 'P|습관/루틴 관리', 'P|개인 목표 관리', 'W|근태', 'W|성과 기록', 'W|커리어 목표 관리', 'W|업무 인맥/네트워킹', 'W|성과 기록·회고', 'W|급여/복지', 'W|회의/업무 일정', 'W|직무 학습']);
(() => {
  let a, c, cat = '', item = '', n = 0;
  for (const line of RAW.trim().split('\n')) {
    if (line[0] === '#') { [a, c] = line.slice(1).split('|'); cat = ''; item = ''; n = 0; continue; }
    const [ct, it, ac, ty, de] = line.split('|');
    if (ct) cat = ct; if (it) item = it;
    const id = `${a}${c}${n++}`;                      // 줄 순서로 id 를 매기므로 숨긴 줄도 번호는 센다
    const row = { id, a, c, cat, item, action: ac, ty: TY[ty], code: ty, detail: de };
    ALL_ROWS.push(row);
    if (HIDDEN_CATS.has(`${a}|${cat}`)) continue;
    ROWS.push(row);
  }
})();
/* 카테고리 표(store.categories)의 "숨김"과 사용자 체크리스트(store.checklist)를 ROWS 에 반영한다.
   ROWS 는 여러 화면이 같은 배열을 보므로 제자리에서 다시 채운다
   store.checklist = { base: 'none'(기본 항목 안 씀, 새 계정) | 없음(기본 항목 씀),
                       hide: [기본 항목 id] (뺀 기본 항목), edits: { id: { action, item, detail, c } } (고친 기본 항목),
                       custom: [{ id: 'u…', a, c, cat, item, action, detail }] (직접 만든 항목) }
   CATS: 화면에 보일 카테고리 [{ a, cat }] — 체크 항목이 하나도 없어도 카테고리 화면(재무 · 캘린더 등)은 남긴다 */
export const CATS = [];
/** 이 계정이 볼 수 있는 영역 (applyCategories 가 맞춤) · 고르기 목록용 [키, 영역] (keep: 지금 값이면 막힌 영역이어도 남김) */
let ALLOWED = 'PBW';
export const allowedAreas = () => ALLOWED;
export const areaEntries = keep => Object.entries(AREAS).filter(([k]) => ALLOWED.includes(k) || k === keep);
let catSig = '', rowsVer = 0;
export const rowsVersion = () => rowsVer;
export const BASE_ROWS = () => ALL_ROWS.filter(r => !HIDDEN_CATS.has(`${r.a}|${r.cat}`));
/** 지금 보이는 카테고리인지 (회원 화면 · 영역 권한 · 숨김 반영) */
export const catShown = (a, cat) => CATS.some(c => c.a === a && c.cat === cat);
let BUILTIN = null;
/** 넣을 수 있는 카테고리인지: 기본 카테고리면 지금 보여야 하고, 직접 만든 이름이면 늘 됨 */
export const catUsable = (a, cat) => { BUILTIN ||= new Set(ALL_ROWS.map(r => `${r.a}|${r.cat}`)); return !BUILTIN.has(`${a}|${cat}`) || catShown(a, cat); };
/** only: 회원 화면이 켜졌을 때 보이는 기본 카테고리 키 Set (관리자가 검수 완료한 것) — 회원이 직접 만든 카테고리는 늘 보임 */
export function applyCategories(cats, cl, areas = 'PBW', only = null) {
  const hide = new Set((cats || []).filter(c => c.hidden).map(c => c.key));
  const C = cl || {};
  const sig = JSON.stringify([[...hide].sort(), C.base || '', C.hide || [], C.edits || {}, C.custom || [], areas, only ? [...only].sort() : null]);
  if (sig === catSig) return;
  catSig = sig; rowsVer++; ALLOWED = areas;
  const off = new Set(C.hide || []), edits = C.edits || {};
  BUILTIN ||= new Set(ALL_ROWS.map(r => `${r.a}|${r.cat}`));
  const shown = k => !HIDDEN_CATS.has(k) && !hide.has(k) && areas.includes(k[0]) && (!only || !BUILTIN.has(k) || only.has(k));   // 볼 수 없는 영역 · 회원 화면에서 뺀 기본 카테고리는 숨김
  ROWS.length = 0; CATS.length = 0;
  const seen = new Set(), addCat = (a, cat) => { const k = `${a}|${cat}`; if (!seen.has(k) && shown(k)) { seen.add(k); CATS.push({ a, cat }); } };
  ALL_ROWS.forEach(r => {
    addCat(r.a, r.cat);
    if (C.base === 'none' || off.has(r.id) || !shown(`${r.a}|${r.cat}`)) return;
    const e = edits[r.id];
    ROWS.push(e ? { ...r, ...e, ty: TY[e.code || r.code], code: e.code || r.code } : r);
  });
  (C.custom || []).forEach(r => {
    if (!r.action || !AREAS[r.a]) return;
    addCat(r.a, r.cat || '기타');
    if (!shown(`${r.a}|${r.cat || '기타'}`)) return;
    ROWS.push({ ...r, cat: r.cat || '기타', item: r.item || r.cat || '기타', detail: r.detail || '', c: CYCLES[r.c] ? r.c : 'D', code: 'N', ty: TY.N, custom: true });
  });
}

export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const PRIO = { 1: '높음', 2: '중간', 3: '낮음' };

/** 기본 우선순위: 기한·예약·알림성은 높음, 회고·정리·계획성은 낮음 */
export const defaultPrio = r =>
  /알림|마감|신고|예약|지급|발주|수금|미수|만료/.test(r.action) || r.item === '체크리스트' ? 1
    : /회고|평가|계획|정리|비교|요약|분석/.test(r.action) ? 3 : 2;

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${pad(Math.ceil(((t - y0) / 864e5 + 1) / 7))}`;
}
/** 체크 상태가 유지되는 기간 키. 일일·수시는 하루, 주간은 주, 월간은 월, 년간은 해 */
export function periodKey(c, d) {
  if (c === 'W') return isoWeek(d);
  if (c === 'M') return iso(d).slice(0, 7);
  if (c === 'Y') return String(d.getFullYear());
  return iso(d);
}
/** a~b(YYYY-MM-DD, 포함) 사이에 걸치는 기간 키 목록. 목표 진행률을 체크 기록으로 계산할 때 쓴다 */
const PK_CACHE = new Map();
export function periodKeysBetween(c, a, b) {
  const ck = `${c}|${a}|${b}`;
  if (PK_CACHE.has(ck)) return PK_CACHE.get(ck);
  const out = [];
  if (a && b && a <= b) {
    const seen = new Set();
    for (let d = new Date(a + 'T00:00:00'), end = new Date(b + 'T00:00:00'); d <= end; d.setDate(d.getDate() + 1)) {
      const k = periodKey(c, d);
      if (!seen.has(k)) { seen.add(k); out.push(k); }
    }
  }
  PK_CACHE.set(ck, out);
  return out;
}
/** 정기 체크가 도래하는 날. 설정에서 바꾸며, 앱이 저장된 값으로 setRules 를 호출해 맞춘다 */
export const DEFAULT_RULES = { weekDay: 0, monthDay: 'last', yearMonth: 12, yearDay: 30 };
let RULES = { ...DEFAULT_RULES };
export const setRules = r => { RULES = { ...DEFAULT_RULES, ...(r || {}) }; };

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const lastDate = (y, m) => new Date(y, m + 1, 0).getDate();   // m: 0~11

/** 주기 규칙 문구 (예: 매주 일요일) */
export function dueRule(c) {
  if (c === 'D') return '매일';
  if (c === 'S') return '필요할 때';
  if (c === 'W') return `매주 ${WEEKDAY[RULES.weekDay]}요일`;
  if (c === 'M') return RULES.monthDay === 'last' ? '매월 말일' : `매월 ${RULES.monthDay}일`;
  if (c === 'Y') return `매년 ${RULES.yearMonth}월 ${RULES.yearDay}일`;
  return '';
}

/** 해당 날짜에 주기가 도래하는지. 수시체크는 도래 개념이 없다.
    월간 기준일이 그 달에 없으면(예: 31일) 그 달 말일에 도래한다 */
/** 매일 항목 중 평일만(wd) · 주말만(we) 하는 것: 그날 해당하는지 (d: Date) */
export const DAYS = { wd: '평일', we: '주말' };
/** 요일 목록: days = 'wd' | 'we' | '2,4'(0=일 … 6=토) → [요일 번호] */
export const WEEK_KO = '일월화수목금토';
export const daySet = days => (days === 'wd' ? [1, 2, 3, 4, 5] : days === 'we' ? [0, 6] : /^[0-6](,[0-6])*$/.test(String(days || '')) ? [...new Set(String(days).split(',').map(Number))] : null);
/** 요일 이름 (월 · 화 순서, 월~일): 평일 · 주말 · 화 · 목 */
export const dayLabel = days => (DAYS[days] || (daySet(days) ? [1, 2, 3, 4, 5, 6, 0].filter(w => daySet(days).includes(w)).map(w => WEEK_KO[w]).join(' · ') : ''));
/** 요일 번호 목록 → 저장 값 (7개면 없음 = 매일, 월~금 = wd, 토·일 = we) */
export const daysOf = wds => { const s = [...new Set(wds)].sort(); const k = s.join(','); return !s.length || s.length === 7 ? undefined : k === '1,2,3,4,5' ? 'wd' : k === '0,6' ? 'we' : k; };
export const dayOk = (r, d) => { const s = daySet(r.days); return !s || s.includes(d.getDay()); };
/** 주기 이름 (평일 · 주말 포함) */
export const cycleName = r => (r.c === 'D' && dayLabel(r.days) ? dayLabel(r.days) : CYCLES[r.c]);
/** 주기 고르기 칸: 'D' · 'D:wd'(평일) · 'D:we'(주말) · 'W' … */
export const CYC_OPTS = (r = null) => [['D', CYCLES.D], ['D:wd', '평일 (월~금)'], ['D:we', '주말 (토 · 일)'], ...(r && r.c === 'D' && daySet(r.days) && !DAYS[r.days] ? [[`D:${r.days}`, `요일: ${dayLabel(r.days)}`]] : []), ...Object.entries(CYCLES).filter(([k]) => k !== 'D')];
export const cycOf = r => (r.c === 'D' && daySet(r.days) ? `D:${r.days}` : r.c);
export const parseCyc = v => { const [c, days] = String(v).split(':'); return { c, days: daySet(days) ? days : undefined }; };
export function isDue(c, d) {
  if (c === 'D') return true;
  if (c === 'W') return d.getDay() === Number(RULES.weekDay);
  if (c === 'M') {
    const last = lastDate(d.getFullYear(), d.getMonth());
    return d.getDate() === (RULES.monthDay === 'last' ? last : Math.min(Number(RULES.monthDay), last));
  }
  if (c === 'Y') {
    const m = Number(RULES.yearMonth) - 1;
    return d.getMonth() === m && d.getDate() === Math.min(Number(RULES.yearDay), lastDate(d.getFullYear(), m));
  }
  return false;
}

/** d 이후(당일 포함) 처음 도래하는 날짜 */
export function nextDue(c, d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  for (let i = 0; i < 370; i++, x.setDate(x.getDate() + 1)) if (isDue(c, x)) return new Date(x);
  return null;
}
