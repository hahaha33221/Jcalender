import DefaultView from './DefaultView.jsx';
import HealthView from './HealthView.jsx';
import AnnivView from './AnnivView.jsx';
import FinanceView from './FinanceView.jsx';
import GoalView from './GoalView.jsx';
import RelationView from './RelationView.jsx';
import LeisureView from './LeisureView.jsx';
import ReviewView from './ReviewView.jsx';

/* 카테고리 상세 화면 등록표
   - 키: '영역|카테고리'  (영역 P 개인, B 사업, W 근로)
   - 값: 화면 컴포넌트. props 로 { area, cat, group } 을 받는다
         group = { cat, rows(액션 목록), items(세부 항목), cyc(주기별 개수), due, left, done }
   - 등록하지 않은 카테고리는 DefaultView(기본 화면)로 보인다

   예) import HealthView from './HealthView.jsx';
import AnnivView from './AnnivView.jsx';
import FinanceView from './FinanceView.jsx';
import GoalView from './GoalView.jsx';
import RelationView from './RelationView.jsx';
import LeisureView from './LeisureView.jsx';
import ReviewView from './ReviewView.jsx';
       'P|건강 관리': HealthView,                                                   */
export const CATEGORY_VIEWS = {
  'P|건강 관리': HealthView,
  'P|기념일 관리': AnnivView,
  'P|개인 재무': FinanceView,
  'P|목표 관리': GoalView,
  'P|인맥/관계 관리': RelationView,
  'P|여가 관리': LeisureView,
  'P|리뷰/회고, 저널링': ReviewView,
  'B|목표 관리': GoalView,
  'W|목표 관리': GoalView,
};

export const viewFor = (area, cat) => CATEGORY_VIEWS[`${area}|${cat}`] || DefaultView;
