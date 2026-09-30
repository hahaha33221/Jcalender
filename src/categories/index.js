import { createElement } from 'react';
import DefaultView from './DefaultView.jsx';
import HealthView from './HealthView.jsx';
import AnnivView from './AnnivView.jsx';
import FinanceView from './FinanceView.jsx';
import GoalView from './GoalView.jsx';
import RelationView from './RelationView.jsx';
import LeisureView from './LeisureView.jsx';
import ReviewView from './ReviewView.jsx';
import LearnHubView from './LearnHubView.jsx';
import ToolView from './ToolView.jsx';
import PlanResearchView from './PlanResearchView.jsx';
import DocsView from './DocsView.jsx';
import { TOOL_CONFIGS } from './toolConfigs.js';

/* 카테고리 상세 화면 등록표
   - 키: '영역|카테고리'  (영역 P 개인, B 사업, W 근로)
   - 값: 화면 컴포넌트. props 로 { area, cat, group } 을 받는다
         group = { cat, rows(액션 목록), items(세부 항목), cyc(주기별 개수), due, left, done }
   - 전용 컴포넌트가 없는 카테고리는 toolConfigs.js 의 설정으로 ToolView 엔진이 그린다
   - 둘 다 없으면 DefaultView(기본 화면) */
const withConfig = config => props => createElement(ToolView, { ...props, config });

export const CATEGORY_VIEWS = {
  'P|건강 관리': HealthView,
  'P|기념일 관리': AnnivView,
  'P|개인 재무': FinanceView,
  'P|목표 관리': GoalView,
  'P|인맥 관리': RelationView,
  'P|여가 관리': LeisureView,
  'P|저널링': ReviewView,
  'P|자기계발/학습': LearnHubView,
  'B|목표 관리': GoalView,
  'W|목표 관리': GoalView,
  'W|기획·조사': PlanResearchView,
  'W|업무 문서': DocsView,
  'W|업무 연락처': props => createElement(RelationView, { ...props, fixedArea: 'W' }),   // 인맥 관리와 같은 사람 데이터 (영역 근로)
  ...Object.fromEntries(Object.entries(TOOL_CONFIGS).map(([k, c]) => [k, withConfig(c)])),
};

export const viewFor = (area, cat) => CATEGORY_VIEWS[`${area}|${cat}`] || DefaultView;
/** 전용 화면이 만들어진 카테고리인지 (영역 페이지 타일에 "완료" 표시) */
export const hasCustomView = (area, cat) => !!CATEGORY_VIEWS[`${area}|${cat}`];
/** 1차 검수를 마친 카테고리 (영역 페이지 타일에 "완료" 대신 "1차 검수" 표시). 목표 관리는 개인·사업·근로 모두 */
const FIRST_REVIEW = new Set(['P|건강 관리', 'P|기념일 관리', 'P|인맥 관리', 'P|여가 관리', 'P|저널링', 'P|개인 재무', 'P|자기계발/학습', 'P|목표 관리', 'B|목표 관리', 'W|목표 관리']);
export const isFirstReviewed = (area, cat) => FIRST_REVIEW.has(`${area}|${cat}`);
