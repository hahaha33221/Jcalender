import React, { useState } from 'react';
import { AREAS, ROWS } from './data.js';
import { useCtx } from './shared.jsx';
import { LEARN_APPS, LEISURE_APPS } from './categories/LearnHubView.jsx';

/* 진행 현황 › 필요한 API · 기능 정리
   1) 연동 현황: 이미 만들어 둔 연동 기능이 지금 설정·연결됐는지 (저장된 설정으로 판단)
   2) 체크리스트 기준: 액션 목록에서 API · AI 가 필요한 항목을 영역 › 카테고리별로 모음 */
const ST = { ok: ['연결됨', 'done'], part: ['설정 필요', 'late'], todo: ['미개발', 'plan'] };

function useIntegrations() {
  const { store } = useCtx();
  const learn = store.learn || {};
  const app = (a, where, cat) => {
    const c = learn[a.key] || {};
    const st = c.data ? 'ok' : 'part';
    return { name: `${a.name} 앱`, where, cat, st,
      state: c.data ? `동기화 ${c.syncedAt || ''}` : c.dataUrl ? '데이터 주소 입력됨 · 동기화 전' : '데이터 주소(JSON) 미입력',
      need: '앱에서 요약 JSON 제공 (docs/learning-app-integration.md), 다른 주소면 CORS 허용' };
  };
  const ai = store.cardAi?.mode || 'off';
  const h = store.health?.imported;
  return [
    { name: '삼성 헬스 데이터', where: '개인', cat: '건강 관리', st: h ? 'ok' : 'part',
      state: h ? `가져옴 ${h.at}` : '아직 가져오지 않음 (예시 기록)', need: '공식 웹 API 없음 → 앱의 "개인 데이터 다운로드" 파일(zip·csv)을 주기적으로 가져오기' },
    { name: '병원 정보 조회', where: '개인', cat: '건강 관리', st: 'todo',
      state: '진찰 기록은 직접 입력', need: '공공데이터포털 병원정보서비스 API 키 + 키를 숨길 서버 (진료 기록 자체는 개인 앱이 가져올 수 없음)' },
    { name: '카드 이용내역 (롯데 · KB국민)', where: '개인', cat: '개인 재무', st: store.finance?.cardImport ? 'ok' : 'part',
      state: store.finance?.cardImport ? `가져옴 ${store.finance.cardImport.at}` : '아직 가져오지 않음',
      need: '공식 개인 API 없음 → 카드사 이용내역 엑셀을 주기적으로 올리기. 자동 수집은 CODEF 같은 중계 API + 서버 필요' },
    { name: '명함 AI 분석', where: '개인', cat: '인맥 관리', st: ai === 'off' ? 'part' : 'ok',
      state: ai === 'off' ? '사용 안 함 (직접 입력)' : ai === 'server' ? `내 서버 ${store.cardAi?.endpoint || ''}` : 'Claude API 직접 호출',
      need: '명함 사진 → JSON 을 돌려주는 서버 (docs/business-card-ai.md) 또는 Claude API 키' },
    ...LEARN_APPS.map(a => app(a, '개인', '자기계발/학습')),
    ...LEISURE_APPS.map(a => app(a, '개인', '여가 관리')),
  ];
}

export default function NeedsPanel() {
  const { openCat } = useCtx();
  const list = useIntegrations();
  const cnt = k => list.filter(x => x.st === k).length;
  // 분류 고르기: 연동 현황은 전체 / 연결됨 / 설정 필요 / 미개발, 체크리스트 기준은 전체 / API / AI
  const [st, setSt] = useState('all');
  const [ty, setTy] = useState('all');
  // 정렬: 연동 현황은 이름 / 상태 / 위치 기준 오름·내림차순, 체크리스트 기준은 카테고리·항목 가나다순 오름·내림차순
  const [sk, setSk] = useState('order');                  // order 기본 순서 · name · st · where
  const [dir, setDir] = useState('asc');
  const [cdir, setCdir] = useState('none');                // none 기본 순서 · asc · desc
  const rank = { ok: 0, part: 1, todo: 2 };
  const keyOf = { name: x => x.name, st: x => rank[x.st], where: x => x.cat };
  const ko = (a, b) => (typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'ko'));
  const filtered = st === 'all' ? list : list.filter(x => x.st === st);
  const shown = sk === 'order' ? (dir === 'asc' ? filtered : [...filtered].reverse())
    : [...filtered].sort((a, b) => (dir === 'asc' ? 1 : -1) * (ko(keyOf[sk](a), keyOf[sk](b)) || ko(a.name, b.name)));
  const csort = l => (cdir === 'none' ? l : [...l].sort((a, b) => (cdir === 'asc' ? 1 : -1) * a.localeCompare(b, 'ko')));
  const need = ROWS.filter(r => (r.code === 'A' || r.code === 'I') && (ty === 'all' || r.code === ty));
  const needAll = ROWS.filter(r => r.code === 'A' || r.code === 'I');
  const byArea = Object.keys(AREAS).map(a => {
    const rows = need.filter(r => r.a === a);
    const cats = csort([...new Set(rows.map(r => r.cat))]).map(cat => {
      const rs = rows.filter(r => r.cat === cat);
      return { cat, rows: cdir === 'none' ? rs : [...rs].sort((a, b) => (cdir === 'asc' ? 1 : -1) * a.action.localeCompare(b.action, 'ko')) };
    });
    return { a, rows, cats };
  });
  return (
    <div className="panel needs">
      <h2>필요한 API · 기능</h2>
      <h3 className="lv-h3">연동 현황</h3>
      <div className="chips nd-chips" role="group" aria-label="연동 상태로 보기">
        {[['all', '전체', list.length], ['ok', '연결됨', cnt('ok')], ['part', '설정 필요', cnt('part')], ['todo', '미개발', cnt('todo')]].map(([k, n, c]) => (
          <button key={k} aria-pressed={st === k} onClick={() => setSt(k)}>{n} <small>{c}</small></button>))}
      </div>
      <div className="nd-sort">
        <label>정렬<select value={sk} onChange={e => setSk(e.target.value)} aria-label="연동 현황 정렬 기준">
          <option value="order">기본 순서</option><option value="name">이름</option><option value="st">상태</option><option value="where">위치(카테고리)</option></select></label>
        <button className="btn sm" onClick={() => setDir(d => (d === 'asc' ? 'desc' : 'asc'))} aria-label="정렬 방향 바꾸기">{dir === 'asc' ? '오름차순 ▲' : '내림차순 ▼'}</button>
      </div>
      {!shown.length && <p className="muted">해당하는 항목이 없습니다.</p>}
      <ul className="nd-list">{shown.map(x => (
        <li key={x.name}>
          <span className="nd-h"><b>{x.name}</b><span className={`st ${ST[x.st][1]}`}>{ST[x.st][0]}</span>
            <button className="nd-go" onClick={() => openCat('P', x.cat)}>{x.where} › {x.cat}</button></span>
          <small className="nd-state">{x.state}</small>
          <small className="muted">필요: {x.need}</small>
        </li>))}</ul>

      <h3 className="lv-h3">체크리스트 기준</h3>
      <div className="chips nd-chips" role="group" aria-label="API · AI 로 보기">
        {[['all', '전체', needAll.length], ['A', 'API', needAll.filter(r => r.code === 'A').length], ['I', 'AI', needAll.filter(r => r.code === 'I').length]].map(([k, n, c]) => (
          <button key={k} aria-pressed={ty === k} onClick={() => setTy(k)}>{n} <small>{c}</small></button>))}
      </div>
      <div className="nd-sort">
        <span>카테고리 · 항목 정렬</span>
        <div className="chips" role="group" aria-label="체크리스트 기준 정렬">
          <button aria-pressed={cdir === 'none'} onClick={() => setCdir('none')}>기본 순서</button>
          <button aria-pressed={cdir === 'asc'} onClick={() => setCdir('asc')}>오름차순 ▲</button>
          <button aria-pressed={cdir === 'desc'} onClick={() => setCdir('desc')}>내림차순 ▼</button>
        </div>
      </div>
      {byArea.map(({ a, rows, cats }) => (
        <details key={a} className="nd-area">
          <summary><b>{AREAS[a].n}</b> <span className="muted">API {rows.filter(r => r.code === 'A').length} · AI {rows.filter(r => r.code === 'I').length} · 카테고리 {cats.length}개</span></summary>
          {cats.map(({ cat, rows: rs }) => (
            <div key={cat} className="nd-cat">
              <button className="nd-go" onClick={() => openCat(a, cat)}>{cat}</button>
              <ul>{rs.map(r => <li key={r.id}><span className={`badge ${r.code}`}>{r.ty}</span><span><b>{r.action}</b> <small className="muted">{r.detail}</small></span></li>)}</ul>
            </div>))}
        </details>))}
    </div>
  );
}
