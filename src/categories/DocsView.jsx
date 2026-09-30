import React, { useEffect, useState } from 'react';
import { areaVar, num, useCtx } from '../shared.jsx';
import { getToken, listChildren, recentFiles, redirectUri, searchDrive, signIn, signOut } from '../onedrive.js';

/* 근로 › 업무 문서: OneDrive 폴더 구조 보기 (읽기 전용)
   - 연결 전에는 예시 폴더 구조를 보여 준다
   - 왼쪽 폴더 트리(펼칠 때 불러옴) + 오른쪽 현재 폴더 목록(경로, 정렬, 검색, 최근 파일)
   - 파일은 OneDrive 웹에서 연다 (이 앱은 파일을 내려받거나 고치지 않음)
   store.onedrive = { clientId, tenant, pins: [{ id, name, trail, demo }], last: [{ id, name }] (마지막으로 본 폴더 경로) } */
const ROOT = { id: 'root', name: '내 파일' };
const KIND = { docx: '문서', doc: '문서', hwp: '문서', hwpx: '문서', xlsx: '엑셀', xls: '엑셀', csv: '엑셀', pptx: 'PPT', ppt: 'PPT', pdf: 'PDF', txt: '텍스트', md: '텍스트', png: '이미지', jpg: '이미지', jpeg: '이미지', zip: '압축' };
const kindOf = x => (x.folder ? '폴더' : KIND[x.ext] || (x.ext ? x.ext.toUpperCase() : '파일'));
const size = b => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const ymd = s => (s ? `${s.slice(0, 4)}. ${s.slice(5, 7)}. ${s.slice(8, 10)}.` : '-');

/* ── 예시 폴더 구조 (연결 전) ── */
function demoTree(now) {
  const d = n => { const t = new Date(now); t.setDate(t.getDate() - n); return t.toISOString(); };
  let k = 0;
  const f = (name, kids) => ({ id: `d${k++}`, name, folder: true, kids });
  const x = (name, days, kb, by = '나') => ({ id: `d${k++}`, name, folder: false, modified: d(days), size: kb * 1024, by, ext: name.split('.').pop().toLowerCase() });
  return f('내 파일', [
    f('01_보고', [
      f('주간보고', [x('주간보고_2026-W39.docx', 3, 84), x('주간보고_2026-W38.docx', 10, 81), x('주간보고_2026-W37.docx', 17, 79)]),
      f('월간보고', [x('9월_월간보고.pptx', 1, 2310), x('8월_월간보고.pptx', 31, 2150)]),
      x('보고서_양식.docx', 120, 45),
    ]),
    f('02_프로젝트', [
      f('프로젝트A', [x('요구사항정의서_v3.docx', 4, 312, '김팀장'), x('일정표.xlsx', 2, 58), x('견적비교.xlsx', 12, 41), f('회의자료', [x('킥오프.pptx', 40, 1800)])]),
      f('프로젝트B', [x('제안서_초안.pptx', 6, 4200), x('시장조사.pdf', 20, 960)]),
    ]),
    f('03_회의록', [x('2026-09_팀회의.docx', 2, 36), x('2026-08_팀회의.docx', 33, 34), x('2026-07_팀회의.docx', 64, 33)]),
    f('04_매뉴얼', [x('배포_매뉴얼.pdf', 45, 820), x('신규입사자_가이드.docx', 90, 150)]),
    f('99_보관', []),
    x('업무_할일.xlsx', 0, 22),
  ]);
}
const demoFlat = t => { const m = {}; const walk = (n, path) => { m[n.id] = { ...n, path }; (n.kids || []).forEach(c => walk(c, n.id === 'd0' ? '' : path ? `${path}/${n.name}` : n.name)); }; walk(t, ''); return m; };
const view = (n, path = '') => ({ id: n.id, name: n.name, folder: n.folder, count: n.folder ? n.kids.length : null, size: n.folder ? 0 : n.size, modified: n.folder ? (n.kids.map(c => c.modified).filter(Boolean).sort().pop() || '') : n.modified, by: n.by || '', url: '', path, ext: n.ext || '' });

export default function DocsView({ area, cat }) {
  const { store, setStore, now } = useCtx();
  const O = store.onedrive || {};
  const setO = patch => setStore(s => ({ ...s, onedrive: { ...(s.onedrive || {}), ...patch } }));
  const [live, setLive] = useState(() => !!(O.clientId && getToken()));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCfg, setShowCfg] = useState(!O.clientId);

  // 예시 데이터
  const [demo] = useState(() => { const t = demoTree(now); return { t, m: demoFlat(t) }; });
  // 폴더 내용 캐시: id → 항목 배열
  const [kids, setKids] = useState({});
  const [open, setOpen] = useState(() => new Set(['root']));
  const [trail, setTrail] = useState(() => (live && O.last?.length ? O.last : [ROOT]));
  const cur = trail[trail.length - 1];
  const [mode, setMode] = useState('folder');                // folder · recent · search
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [sort, setSort] = useState({ k: 'name', dir: 1 });

  const load = async id => {
    if (kids[id]) return kids[id];
    if (!live) {
      const n = id === 'root' ? demo.t : demo.m[id];
      const list = (n?.kids || []).map(c => view(c, demo.m[c.id].path));
      setKids(s => ({ ...s, [id]: list })); return list;
    }
    try {
      setBusy(true); setErr('');
      const list = await listChildren(O, id === 'root' ? null : id);
      setKids(s => ({ ...s, [id]: list })); return list;
    } catch (e) { fail(e); return []; } finally { setBusy(false); }
  };
  const fail = e => { setErr(e.message); if (e.auth) { setLive(false); setKids({}); setTrail([ROOT]); } };
  useEffect(() => { load(cur.id); }, [cur.id, live]);
  useEffect(() => { if (live) setO({ last: trail }); }, [trail, live]);

  const goTo = t => { setTrail(t); setMode('folder'); setOpen(s => new Set([...s, ...t.map(x => x.id)])); t.slice(0, -1).forEach(x => load(x.id)); };
  const enter = x => goTo([...trail, { id: x.id, name: x.name }]);
  const connect = async () => {
    setBusy(true); setErr('');
    try { await signIn(O); setKids({}); setTrail([ROOT]); setLive(true); setShowCfg(false); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const disconnect = () => { signOut(); setLive(false); setKids({}); setTrail([ROOT]); setMode('folder'); setFound(null); };

  const doSearch = async () => {
    const w = q.trim(); if (!w) return;
    setMode('search'); setFound(null);
    if (!live) { setFound(Object.values(demo.m).filter(n => n.id !== 'd0' && n.name.toLowerCase().includes(w.toLowerCase())).map(n => view(n, n.path))); return; }
    try { setBusy(true); setFound(await searchDrive(O, w)); } catch (e) { fail(e); setFound([]); } finally { setBusy(false); }
  };
  const showRecent = async () => {
    setMode('recent'); setFound(null);
    if (!live) { setFound(Object.values(demo.m).filter(n => !n.folder).sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 15).map(n => view(n, n.path))); return; }
    try { setBusy(true); setFound(await recentFiles(O)); } catch (e) { fail(e); setFound([]); } finally { setBusy(false); }
  };

  const items = mode === 'folder' ? kids[cur.id] : found;
  const cmp = { name: (a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }), modified: (a, b) => a.modified.localeCompare(b.modified), size: (a, b) => a.size - b.size, kind: (a, b) => kindOf(a).localeCompare(kindOf(b), 'ko') };
  const rows = items ? [...items].sort((a, b) => (mode === 'recent' && sort.k === 'name' ? 0 : (b.folder - a.folder) || sort.dir * cmp[sort.k](a, b) || cmp.name(a, b))) : null;
  const th = (k, label, cls = '') => (
    <th className={`fv-sort ${cls}`} aria-sort={sort.k === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : k === 'modified' ? -1 : 1 }))}>{label}<i>{sort.k === k ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</i></button></th>);

  // 통계 (현재 폴더 기준)
  const here = kids[cur.id] || [];
  const files = here.filter(x => !x.folder);
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 30);
  const stale = files.filter(x => x.modified && x.modified < cutoff.toISOString()).length;
  // 즐겨찾기: 예시 폴더와 실제 OneDrive 폴더를 따로 둔다
  const all = O.pins || [];
  const pins = all.filter(p => !!p.demo === !live);
  const pinned = pins.some(p => p.id === cur.id);
  const togglePin = () => setO({ pins: pinned ? all.filter(p => !(p.id === cur.id && !!p.demo === !live)) : [...all, { id: cur.id, name: cur.name, trail, demo: !live }] });

  return (
    <div className="catv od" style={{ '--ac': areaVar(area) }}>
      <header className="page-h"><h1 className="area-title">{cat}</h1>
        <p>OneDrive 폴더 구조를 그대로 보고, 파일은 OneDrive에서 엽니다.</p></header>

      <div className="hv-stats">
        <div className={`hv-stat ${live ? 'ex' : 'over'}`}><span className="muted">OneDrive</span><b>{live ? '연결됨' : '연결 전'}</b><span className="hv-sub">{live ? '읽기 전용' : '아래는 예시 폴더 구조'}</span></div>
        <div className="hv-stat sl"><span className="muted">현재 폴더</span><b>{here.length}개</b><span className="hv-sub">폴더 {here.length - files.length} · 파일 {files.length}</span></div>
        <div className="hv-stat sl"><span className="muted">파일 용량</span><b>{size(files.reduce((a, x) => a + x.size, 0))}</b><span className="hv-sub">현재 폴더 파일 합계</span></div>
        <div className={`hv-stat ${stale ? 'over' : 'ex'}`}><span className="muted">30일 넘게 수정 안 됨</span><b>{stale}개</b><span className="hv-sub">정리 대상 (현재 폴더)</span></div>
      </div>

      <section className="panel od-cfg">
        <div className="csum-h"><h2>OneDrive 연결</h2>
          <span className={`od-st ${live ? 'on' : ''}`}>{live ? '연결됨' : O.clientId ? '로그인 필요' : '설정 필요'}</span>
          <span className="grow" />
          {live ? <button className="btn sm" onClick={disconnect}>연결 해제</button>
            : <button className="btn primary sm" onClick={connect} disabled={!O.clientId || busy}>Microsoft 계정으로 로그인</button>}
          <button className="btn sm" onClick={() => setShowCfg(v => !v)} aria-expanded={showCfg}>{showCfg ? '설정 닫기' : '설정'}</button></div>
        {err && <p className="od-err" role="alert">{err}</p>}
        {showCfg && (
          <div className="od-form">
            <label>클라이언트 ID<input value={O.clientId || ''} onChange={e => setO({ clientId: e.target.value.trim() })} placeholder="Azure 앱 등록의 애플리케이션(클라이언트) ID" /></label>
            <label>테넌트<select value={O.tenant || 'common'} onChange={e => setO({ tenant: e.target.value })}>
              <option value="common">개인 + 회사 계정 (common)</option><option value="organizations">회사·학교 계정만 (organizations)</option><option value="consumers">개인 계정만 (consumers)</option></select></label>
            <label>리디렉션 URI<input readOnly value={redirectUri()} onFocus={e => e.target.select()} /></label>
            <ol className="od-steps">
              <li>Azure 포털 › Microsoft Entra ID › 앱 등록 › 새 등록</li>
              <li>플랫폼 "단일 페이지 애플리케이션(SPA)", 리디렉션 URI에 위 주소 입력</li>
              <li>API 권한: Microsoft Graph 위임 권한 <code>Files.Read</code>, <code>User.Read</code>, <code>offline_access</code></li>
              <li>개요의 "애플리케이션(클라이언트) ID"를 위 칸에 붙여넣고 로그인</li>
            </ol>
            <p className="note">자세한 순서는 docs/onedrive-integration.md. 회사 계정은 관리자 동의가 필요할 수 있습니다. 파일을 읽기만 하며 수정·삭제하지 않습니다.</p>
          </div>
        )}
      </section>

      <div className="od-grid">
        <aside className="panel od-side">
          {pins.length > 0 && <>
            <h3 className="pr-h3">즐겨찾는 폴더</h3>
            <ul className="od-pins">{pins.map(p => <li key={p.id}><button className={p.id === cur.id ? 'on' : ''} onClick={() => goTo(p.trail || [ROOT, { id: p.id, name: p.name }])}>{p.name}</button></li>)}</ul>
          </>}
          <h3 className="pr-h3">폴더</h3>
          <Tree node={ROOT} depth={0} trail={[ROOT]} kids={kids} load={load} open={open} setOpen={setOpen} cur={cur.id} goTo={goTo} />
        </aside>

        <section className="panel od-main">
          <div className="od-bar">
            <nav className="od-crumb" aria-label="경로">{trail.map((t, i) => (
              <React.Fragment key={t.id}>{i > 0 && <span aria-hidden="true">›</span>}
                <button onClick={() => goTo(trail.slice(0, i + 1))} disabled={mode === 'folder' && i === trail.length - 1}>{t.name}</button></React.Fragment>))}</nav>
            {cur.id !== 'root' && mode === 'folder' && <button className="btn sm" onClick={togglePin}>{pinned ? '즐겨찾기 해제' : '즐겨찾기'}</button>}
          </div>
          <div className="od-tools">
            <span className="chips">
              <button aria-pressed={mode === 'folder'} onClick={() => setMode('folder')}>폴더</button>
              <button aria-pressed={mode === 'recent'} onClick={showRecent}>최근 파일</button>
            </span>
            <input type="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} placeholder="파일 이름 검색" aria-label="파일 검색" />
            <button className="btn sm" onClick={doSearch} disabled={!q.trim()}>검색</button>
            {busy && <span className="muted">불러오는 중…</span>}
          </div>
          {mode !== 'folder' && <p className="muted od-mode">{mode === 'recent' ? '최근에 열거나 수정한 파일' : `"${q}" 검색 결과`}{rows ? ` · ${rows.length}건` : ''}</p>}
          {rows ? (rows.length ? (
            <div className="od-tablewrap"><table className="fv-table od-table">
              <thead><tr>{th('name', '이름')}{th('kind', '종류', 'c')}{th('modified', '수정일')}<th className="od-by">수정한 사람</th>{th('size', '크기', 'r')}<th /></tr></thead>
              <tbody>{rows.map(x => (
                <tr key={x.id} className={x.folder ? 'od-folder' : ''}>
                  <td className="od-name">
                    {x.folder ? <button className="linkish" onClick={() => (mode === 'folder' ? enter(x) : goTo([ROOT, { id: x.id, name: x.name }]))}><i className="od-ic f" aria-hidden="true" />{x.name}</button>
                      : <span><i className={`od-ic ${x.ext}`} aria-hidden="true" />{x.name}</span>}
                    {mode !== 'folder' && x.path && <small className="od-path">{x.path}</small>}
                  </td>
                  <td className="c">{kindOf(x)}</td>
                  <td className="nw">{ymd(x.modified)}</td>
                  <td className="od-by">{x.by || '-'}</td>
                  <td className="r nw">{x.folder ? (x.count != null ? `${num(x.count)}개` : '-') : size(x.size)}</td>
                  <td className="r">{x.url ? <a className="btn sm" href={x.url} target="_blank" rel="noreferrer">열기</a> : !live && <span className="muted">예시</span>}</td>
                </tr>))}</tbody>
            </table></div>
          ) : <p className="muted">{mode === 'folder' ? '빈 폴더입니다.' : '해당하는 파일이 없습니다.'}</p>) : <p className="muted">불러오는 중…</p>}
        </section>
      </div>
    </div>
  );
}

/** 왼쪽 폴더 트리 (펼칠 때 하위 폴더를 불러온다) */
function Tree({ node, depth, trail, kids, load, open, setOpen, cur, goTo }) {
  const isOpen = open.has(node.id);
  const sub = (kids[node.id] || []).filter(x => x.folder).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  const toggle = () => { if (!isOpen) load(node.id); setOpen(s => { const n = new Set(s); n.has(node.id) ? n.delete(node.id) : n.add(node.id); return n; }); };
  const leaf = kids[node.id] && !sub.length;
  return (
    <div className="od-node">
      <div className={`od-row ${cur === node.id ? 'on' : ''}`} style={{ paddingLeft: depth * 14 }}>
        <button className="od-tog" onClick={toggle} aria-label={isOpen ? '접기' : '펼치기'} aria-expanded={isOpen} disabled={leaf}>{leaf ? '' : isOpen ? '▾' : '▸'}</button>
        <button className="od-fn" onClick={() => { goTo(trail); if (!isOpen) toggle(); }}>{node.name}</button>
      </div>
      {isOpen && sub.map(c => <Tree key={c.id} node={c} depth={depth + 1} trail={[...trail, { id: c.id, name: c.name }]} {...{ kids, load, open, setOpen, cur, goTo }} />)}
    </div>
  );
}
