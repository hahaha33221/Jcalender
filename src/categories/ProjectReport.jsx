import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { won } from './finance.js';

/* 연계 프로젝트 보고서 (PDF)
   - 보고서 미리보기 창 → "PDF로 저장" = 브라우저 인쇄 창에서 "PDF로 저장" 선택 (한글 글꼴을 따로 넣지 않아도 됨)
   - 구성: 1. 개요 · 2. 안건 · 3. 안건 별 주요 내용 · 4. 결론 · 5. 향후 진행 사항 · 6. 기타
   - 글자는 검은색, 음영 없음, 내용은 모두 테두리 칸 안에 (인쇄용)
   - 4 · 5 · 6 은 미리보기에서 직접 고쳐 쓸 수 있고 finance.report 에 저장된다 */
const dot = s => (s ? `${s.slice(0, 4)}. ${s.slice(5, 7)}. ${s.slice(8, 10)}.` : '');
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

export default function ProjectReport({ f, update, today, onClose }) {
  const projects = f.projects || [];
  const [pick, setPick] = useState(() => new Set(projects.map(p => p.id)));
  const R = f.report || {};
  const setR = patch => update(x => ({ ...x, report: { ...(x.report || {}), ...patch } }));
  const chosen = projects.filter(p => pick.has(p.id));
  const data = chosen.map(p => {
    const ex = f.expenses.filter(e => e.projectId === p.id).sort((a, b) => a.date.localeCompare(b.date));
    const sum = ex.reduce((a, e) => a + e.amount, 0);
    const byCat = Object.entries(ex.reduce((m, e) => { m[e.cat] = (m[e.cat] || 0) + e.amount; return m; }, {})).sort((a, b) => b[1] - a[1]);
    const byMonth = Object.entries(ex.reduce((m, e) => { const k = e.date.slice(0, 7); m[k] = (m[k] || 0) + e.amount; return m; }, {})).sort();
    return { p, ex, sum, byCat, byMonth };
  });
  const all = data.flatMap(d => d.ex), total = all.reduce((a, e) => a + e.amount, 0);
  const dates = all.map(e => e.date).sort();
  const top = [...data].sort((a, b) => b.sum - a.sum)[0];
  const catAll = Object.entries(all.reduce((m, e) => { m[e.cat] = (m[e.cat] || 0) + e.amount; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const autoConclusion = data.length
    ? [`연계 프로젝트 ${data.length}건에 연결된 지출은 총 ${all.length}건, ${won(total)}입니다.`,
      top && top.sum ? `지출이 가장 큰 프로젝트는 "${top.p.name}"(${won(top.sum)}, ${total ? Math.round(top.sum / total * 100) : 0}%)입니다.` : '',
      catAll[0] ? `분류별로는 ${catAll.slice(0, 3).map(([c, v]) => `${c} ${won(v)}`).join(', ')} 순으로 많습니다.` : ''].filter(Boolean).join('\n')
    : '';

  // 인쇄할 때는 앱 화면을 숨기고 보고서만
  useEffect(() => {
    document.body.classList.add('report-open');
    const esc = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { document.body.classList.remove('report-open'); window.removeEventListener('keydown', esc); };
  }, []);
  const print = () => {
    const t = document.title;
    document.title = `project_report_${today.replace(/-/g, '')}`;           // PDF 파일 이름 (영문)
    window.print();
    setTimeout(() => { document.title = t; }, 500);
  };

  return createPortal(
    <div className="rp-wrap" role="dialog" aria-label="연계 프로젝트 보고서">
      <div className="rp-bar no-print">
        <b>연계 프로젝트 보고서</b>
        <span className="rp-pick">{projects.map(p => (
          <label key={p.id}><input type="checkbox" checked={pick.has(p.id)} onChange={e => setPick(s => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />{p.name}</label>))}</span>
        <button className="btn primary" onClick={print} disabled={!chosen.length}>PDF로 저장 / 인쇄</button>
        <button className="btn" onClick={onClose}>닫기</button>
        <small>인쇄 창에서 대상을 "PDF로 저장"으로 고르세요. 4 · 5 · 6 은 아래에서 바로 고쳐 쓸 수 있습니다.</small>
      </div>

      <article className="rp">
        <h1>연계 프로젝트 보고서</h1>
        <table className="rp-meta"><tbody>
          <tr><th>작성일</th><td>{dot(today)}</td><th>대상</th><td>개인 재무 · 연계 프로젝트 {chosen.length}건</td></tr>
        </tbody></table>

        <h2>1. 개요</h2>
        <div className="rp-box">
          <ul>
            <li>목적: 개인 재무 지출 중 연계 프로젝트에 연결된 지출과 메모를 한데 모아 정리</li>
            <li>대상 기간: {dates.length ? `${dot(dates[0])} ~ ${dot(dates[dates.length - 1])}` : '연결된 지출 없음'}</li>
            <li>대상: 프로젝트 {chosen.length}건 · 연계 지출 {all.length}건 · 합계 {won(total)}</li>
            <li>자료: 카드 이용내역 반영 지출(롯데카드 · KB국민카드 등)과 프로젝트 메모</li>
          </ul>
        </div>

        <h2>2. 안건</h2>
        <table className="rp-table"><thead><tr><th>No.</th><th>프로젝트</th><th>연계 지출</th><th>합계</th><th>비중</th><th>최근 수정</th></tr></thead>
          <tbody>{data.map((d, i) => (
            <tr key={d.p.id}><td className="c">{i + 1}</td><td>{d.p.name}</td><td className="r">{d.ex.length}건</td><td className="r">{won(d.sum)}</td>
              <td className="r">{total ? Math.round(d.sum / total * 100) : 0}%</td><td className="c">{dot(d.p.updated)}</td></tr>))}
            <tr className="rp-sum"><td colSpan={2} className="c">합계</td><td className="r">{all.length}건</td><td className="r">{won(total)}</td><td className="r">{total ? '100%' : '-'}</td><td /></tr>
          </tbody></table>

        <h2>3. 안건 별 주요 내용</h2>
        {data.map((d, i) => (
          <section key={d.p.id} className="rp-item">
            <h3>3.{i + 1} {d.p.name}</h3>
            <div className="rp-box">
              <p className="rp-label">가. 요약</p>
              <p>연계 지출 {d.ex.length}건 · 합계 {won(d.sum)}{d.ex.length ? ` · 기간 ${dot(d.ex[0].date)} ~ ${dot(d.ex[d.ex.length - 1].date)}` : ''}</p>
              <p className="rp-label">나. 메모</p>
              <p className="rp-pre">{d.p.note?.trim() || '(메모 없음)'}</p>
              {d.byCat.length > 0 && <>
                <p className="rp-label">다. 분류별 · 월별 합계</p>
                <table className="rp-table rp-half"><thead><tr><th>분류</th><th>금액</th></tr></thead>
                  <tbody>{d.byCat.map(([c, v]) => <tr key={c}><td>{c}</td><td className="r">{won(v)}</td></tr>)}</tbody></table>
                <table className="rp-table rp-half"><thead><tr><th>월</th><th>금액</th></tr></thead>
                  <tbody>{d.byMonth.map(([m, v]) => <tr key={m}><td>{m.slice(0, 4)}년 {Number(m.slice(5))}월</td><td className="r">{won(v)}</td></tr>)}</tbody></table>
              </>}
              <p className="rp-label">라. 연계 지출 내역</p>
              {d.ex.length ? (
                <table className="rp-table"><thead><tr><th>No.</th><th>날짜</th><th>분류</th><th>내용</th><th>카드</th><th>금액</th></tr></thead>
                  <tbody>{d.ex.map((e, k) => <tr key={e.id}><td className="c">{k + 1}</td><td className="c">{md(e.date)}</td><td>{e.cat}</td><td>{e.memo}</td><td>{e.card || '직접 입력'}</td><td className="r">{won(e.amount)}</td></tr>)}
                    <tr className="rp-sum"><td colSpan={5} className="c">소계</td><td className="r">{won(d.sum)}</td></tr></tbody></table>
              ) : <p>연결된 지출이 없습니다.</p>}
            </div>
          </section>
        ))}

        <h2>4. 결론</h2>
        <div className="rp-box"><Editable value={R.conclusion ?? autoConclusion} onChange={v => setR({ conclusion: v })} placeholder="결론을 적어 주세요" />
          {R.conclusion != null && <button className="btn sm no-print" onClick={() => setR({ conclusion: undefined })}>자동 문장으로 되돌리기</button>}</div>

        <h2>5. 향후 진행 사항</h2>
        <div className="rp-box"><Editable value={R.next || ''} onChange={v => setR({ next: v })} placeholder="예: 다음 달 예산 조정, 견적 비교, 결제 일정 확인 등" /></div>

        <h2>6. 기타</h2>
        <div className="rp-box"><Editable value={R.etc ?? '금액은 카드사 이용내역(명세서) 반영 기준이며, 취소 건과 원화 미확정 해외 이용은 제외되어 있습니다.'} onChange={v => setR({ etc: v })} placeholder="기타 사항" /></div>
      </article>
    </div>,
    document.body,
  );
}

/** 인쇄에서는 그냥 글처럼 보이는 여러 줄 입력칸 */
function Editable({ value, onChange, placeholder }) {
  return (
    <>
      <textarea className="rp-edit no-print" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        rows={Math.max(3, (value.match(/\n/g) || []).length + 2)} />
      <p className="rp-pre print-only">{value || ' '}</p>
    </>
  );
}
