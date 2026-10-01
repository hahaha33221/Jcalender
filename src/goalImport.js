import { readXlsxBook } from './xlsx.js';

/* 목표 관리 엑셀(마스터플랜) → 목표 보드
   - "YYYY_로드맵" 시트: 구분(WANT·Doing·Learning) · 대분류 · 증분류 · 소분류 · 개념 · 목표(그 해 · 중간 · 최종)
       → 개인 › 목표 관리(영역 공통) 보드: [구분] 대분류 → 증분류 → 개념(목표), 기간은 그 해 1/1~12/31
         (개념에 "2027 …"처럼 해가 적혀 있으면 그 해). 내용이 같은 다른 해 시트는 한 번만 넣는다
   - "Master" 시트(+ "(1) 개념"의 착수 시기 · ICE): 회사 → 프로젝트(우선순위) → 1차 MVP · 목표지표
       → 사업 › 목표 관리(영역 공통) 보드, 프로젝트 기간은 착수 달 ~ 그 해 말, 착수 달에 마일스톤
   결과: { boards: { 'P|목표 관리': { items, miles }, 'B|목표 관리': { … } }, counts } */
const s = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const cleanNo = v => s(v).replace(/^(\d+)\s*\.?\s*(\d+)\s+/, '$1.$2.');      // "0.1 Intimum" → "0.1.Intimum"
const keyName = v => s(v).replace(/[\s.()]/g, '').toLowerCase();

function headerIdx(rows, need) {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const h = (rows[i] || []).map(x => { const t = s(x); return t.length <= 20 ? t : ''; });   // 긴 제목(병합된 표 제목 줄)은 머리글이 아님
    if (need.every(n => h.some(x => x.includes(n)))) return { i, col: n => h.findIndex(x => x.includes(n)) };
  }
  return null;
}

export async function parseGoalBook(file) {
  const book = readXlsxBook(new Uint8Array(await file.arrayBuffer()));
  return buildGoalBoards(book);
}

export function buildGoalBoards(book, uid = () => Math.random().toString(36).slice(2, 10)) {
  const P = { items: [], miles: [] }, B = { items: [], miles: [] };
  const counts = { roadmapYears: [], personal: 0, projects: 0, skippedSame: [] };

  /* ── 로드맵 → 개인 목표 ── */
  const seen = new Map();
  book.filter(sh => /(\d{4})\s*_?\s*로드맵/.test(sh.name)).forEach(sh => {
    const year = Number(sh.name.match(/(\d{4})/)[1]);
    const H = headerIdx(sh.rows, ['구분', '대분류']);
    if (!H) return;
    const c = { kind: H.col('구분'), big: H.col('대분류'), mid: H.col('증분류'), small: H.col('소분류'), ch: H.col('채널'), con: H.col('개념'), now: H.col('현재상황'),
      goal: sh.rows[H.i].findIndex(x => /\d{4}\s*목표/.test(s(x))), midG: H.col('중간목표'), fin: H.col('최종 목표') >= 0 ? H.col('최종 목표') : H.col('최종목표') };
    const lines = sh.rows.slice(H.i + 1).map(r => ({ kind: s(r[c.kind]), big: s(r[c.big]), mid: s(r[c.mid]).replace(/^-$/, ''), small: c.small >= 0 ? s(r[c.small]) : '', ch: c.ch >= 0 ? s(r[c.ch]) : '',
      con: s(r[c.con]), now: c.now >= 0 ? s(r[c.now]) : '', goal: c.goal >= 0 ? s(r[c.goal]) : '', midG: c.midG >= 0 ? s(r[c.midG]) : '', fin: c.fin >= 0 ? s(r[c.fin]) : '' }))
      .filter(l => l.big || l.mid || l.small || l.con || l.goal);
    const sig = JSON.stringify(lines);
    if (seen.has(sig)) { counts.skippedSame.push(`${sh.name} (= ${seen.get(sig)})`); return; }
    seen.set(sig, sh.name);
    counts.roadmapYears.push(year);
    const y0 = `${year}-01-01`, y1 = `${year}-12-31`;
    const node = new Map();                                 // 경로 → item
    const get = (path, name, parent, a = y0, b = y1) => {
      const k = path.join('>');
      if (node.has(k)) { const it = node.get(k); if (a < it.start) it.start = a; if (b > it.end) it.end = b; return it; }
      const it = { id: uid(), parent: parent ? parent.id : null, name, start: a, end: b, progress: 0 };
      node.set(k, it); P.items.push(it);
      return it;
    };
    lines.forEach(l => {
      const yy = Number((l.con.match(/^(20\d{2})\b/) || [])[1]) || year;   // "2027 결혼" → 2027 년
      const a = `${yy}-01-01`, b = `${yy}-12-31`;
      const top = get([year, l.kind, l.big || '기타'], `${l.kind ? `[${l.kind}] ` : ''}${l.big || (l.kind === 'Learning' ? '학습' : '기타')}`, null, a, b);
      const midIt = l.mid ? get([year, l.kind, l.big, l.mid], l.mid + (l.ch && !l.con ? ` (${l.ch})` : ''), top, a, b) : top;
      const label = l.con || l.small;
      if (!label && !l.goal) return;
      const parts = [l.goal && `${yy} 목표: ${l.goal}`, l.midG && `중간: ${l.midG}`, l.fin && `최종: ${l.fin}`, l.now && `현재: ${l.now}`].filter(Boolean);
      const name = `${label || l.mid || l.big}${l.ch && l.con ? ` [${l.ch}]` : ''}${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
      if (label) get([year, l.kind, l.big, l.mid, label, l.goal], name, midIt, a, b);
      else if (l.goal && midIt !== top) midIt.name = `${midIt.name} — ${parts.join(' · ')}`;
      counts.personal++;
    });
  });

  /* ── Master (+ 개념 시트의 착수 시기 · ICE) → 사업 목표 ── */
  const master = book.find(sh => /^master$/i.test(sh.name.trim()));
  const concept = book.find(sh => /개념/.test(sh.name) && headerIdx(sh.rows, ['프로젝트', '착수']));
  const start = new Map(), ice = new Map();
  if (concept) {
    const H = headerIdx(concept.rows, ['프로젝트', '착수']);
    const cp = H.col('프로젝트'), ct = H.col('착수 시기') >= 0 ? H.col('착수 시기') : H.col('착수'), ci = concept.rows[H.i].findIndex(x => /ICE/.test(s(x)));
    concept.rows.slice(H.i + 1).forEach(r => {
      const tv = typeof r[ct] === 'number' ? r[ct].toFixed(2) : s(r[ct]);   // 2026.10 이 숫자 2026.1 로 읽혀도 10월로
      const name = keyName(cleanNo(r[cp])), m = tv.match(/(20\d{2})\D+(\d{1,2})/);
      if (!name) return;
      if (m) start.set(name, `${m[1]}-${m[2].padStart(2, '0')}-01`);
      if (ci >= 0 && s(r[ci])) ice.set(name, s(r[ci]));
    });
  }
  if (master) {
    const H = headerIdx(master.rows, ['카테고리', '프로젝트명']);
    if (H) {
      const col = n => H.col(n);
      const c = { no: col('넘버링'), cat: col('카테고리'), name: col('프로젝트명'), pr: col('우선순위'), prob: col('문제정의'), target: col('타겟'), sol: col('솔루션'), mvp: col('1차 MVP'), kpi: col('목표지표') };
      const rows = master.rows.slice(H.i + 1).filter(r => s(r[c.name]))
        .map(r => ({ no: Number(r[c.no]) || 0, cat: s(r[c.cat]), name: cleanNo(r[c.name]), pr: Number(r[c.pr]) || 99, prob: s(r[c.prob]), target: s(r[c.target]), sol: s(r[c.sol]), mvp: s(r[c.mvp]), kpi: s(r[c.kpi]) }));
      const fallbackYear = counts.roadmapYears[0] || new Date().getFullYear();
      const cats = [...new Set(rows.slice().sort((a, b) => a.cat.localeCompare(b.cat, 'ko', { numeric: true })).map(r => r.cat))];
      cats.forEach(cat => {
        const list = rows.filter(r => r.cat === cat).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
        const top = { id: uid(), parent: null, name: cat, start: '', end: '', progress: 0 };
        B.items.push(top);
        list.forEach(r => {
          const st = start.get(keyName(r.name)) || `${fallbackYear}-01-01`, en = `${st.slice(0, 4)}-12-31`;
          const it = { id: uid(), parent: top.id, name: `${r.name} (우선순위 ${r.pr}${ice.get(keyName(r.name)) ? ` · ICE ${ice.get(keyName(r.name))}` : ''})`, start: st, end: en, progress: 0 };
          B.items.push(it);
          [['1차 MVP', r.mvp], ['목표지표', r.kpi], ['문제 · 해결', [r.prob, r.sol].filter(Boolean).join(' → ')]].forEach(([k, v]) => {
            if (v) B.items.push({ id: uid(), parent: it.id, name: `${k}: ${v}`, start: st, end: en, progress: 0 });
          });
          if (start.has(keyName(r.name))) B.miles.push({ id: uid(), name: `${r.name} 착수`, date: st, link: it.id, done: false });
          counts.projects++;
        });
        const kids = B.items.filter(i => i.parent === top.id);
        top.start = kids.map(i => i.start).sort()[0] || `${fallbackYear}-01-01`;
        top.end = kids.map(i => i.end).sort().pop() || `${fallbackYear}-12-31`;
      });
    }
  }
  if (!P.items.length && !B.items.length) throw new Error('로드맵(YYYY_로드맵) 또는 Master 시트를 찾지 못했습니다');
  return { boards: { ...(P.items.length ? { 'P|목표 관리': P } : {}), ...(B.items.length ? { 'B|목표 관리': B } : {}) }, counts };
}
