/* 연락처 엑셀 가져오기 (개인 › 인맥 관리)
   - 모든 시트를 읽고, "이름" 머리글이 있는 줄을 찾아 표로 본다 (편집 기록 같은 시트는 자동으로 건너뜀)
   - 한 줄에 표가 여러 개 나란히 있으면(조직도처럼) 빈 열을 기준으로 나눠 따로 읽는다
   - 병합된 칸(부서·팀)은 아래 줄까지 같은 값으로 채워 읽는다 (xlsx.js readXlsxBook)
   - 머리글 이름으로 열을 찾는다: 기관/회사 · 소속/부서 · 팀 · 이름 · 직책 · Tel/내선 · Mobile/휴대폰 · Fax · 이메일 · 비고 · 확인필요
   - 같은 사람(휴대폰 → 이메일 → 이름+회사 순으로 비교)은 한 명으로 합치고, 빈 칸만 채운다 */
import { readXlsxBook } from './xlsx.js';

const HEAD = {
  no: /^(넘버링|번호|no\.?|순번)$/i,
  company: /기관|회사|업체/,
  dept: /소속|부서/,
  team: /^팀$|^팀명$/,
  name: /^(이름|성명)$/,
  title: /직책|직함|직급|직위/,
  mobile: /mobile|휴대폰|핸드폰|휴대전화/i,
  tel: /^tel\d*$|전화|내선/i,
  fax: /fax|팩스/i,
  email: /이메일|e-?mail/i,
  check: /확인 ?필요/,
  note: /비고|메모/,
};
const kindOf = h => Object.keys(HEAD).find(k => HEAD[k].test(h)) || null;
const clean = v => String(v ?? '').replace(/ /g, ' ').replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim();

/** 휴대폰: +82 10 1234 5678 / 82 10-1234-5678 / 01012345678 → 010-1234-5678 */
export function normMobile(s) {
  const d = String(s).replace(/[^\d]/g, '');
  const k = d.startsWith('8210') ? `0${d.slice(2)}` : d.startsWith('10') && d.length === 10 ? `0${d}` : d;
  if (/^01[016789]\d{7,8}$/.test(k)) return k.length === 11 ? `${k.slice(0, 3)}-${k.slice(3, 7)}-${k.slice(7)}` : `${k.slice(0, 3)}-${k.slice(3, 6)}-${k.slice(6)}`;
  return clean(s);
}
const keyPhone = s => { const d = String(s || '').replace(/[^\d]/g, ''); return d.length >= 10 ? d.slice(-8) : ''; };
/** 같은 사람인지 비교하는 열쇠들 */
export const personKeys = p => [
  keyPhone(p.phone) && `m:${keyPhone(p.phone)}`,
  p.email && `e:${p.email.toLowerCase()}`,
  p.name && `n:${p.name.replace(/\s|\(.*?\)/g, '')}|${(p.company || '').replace(/\s/g, '')}`,
].filter(Boolean);

/** 시트 안에서 머리글 줄 찾기: "이름"과 다른 연락처 머리글이 함께 있는 줄 */
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const kinds = (rows[i] || []).map(v => kindOf(clean(v)));
    if (kinds.includes('name') && kinds.filter(k => k && k !== 'name').length >= 2) return i;
  }
  return -1;
}

/** 머리글 줄을 빈 열 기준으로 나눈 표 조각들 */
function blocksOf(head) {
  const out = []; let cur = null;
  head.forEach((v, c) => {
    const h = clean(v);
    if (!h) { cur = null; return; }
    if (!cur) { cur = { cols: [] }; out.push(cur); }
    cur.cols.push({ c, h, kind: kindOf(h) });
  });
  return out.filter(b => b.cols.some(x => x.kind === 'name'));
}

/** 표 조각의 열 역할 정하기. 병합된 머리글(같은 이름이 연달아)은
    - 이름 두 칸: 앞 칸 이름, 뒤 칸 직책 (직책 열이 따로 없을 때)
    - 그 밖(예: 부서 두 칸): 뒤 칸이 본 값, 앞 칸은 위치(사무실 코드 등) */
function roles(block) {
  const r = { tel: [], mobile: [], email: [], fax: [], note: [], loc: [] };
  const runs = [];
  block.cols.forEach(x => { const last = runs[runs.length - 1]; if (last && last.h === x.h && last.cols[last.cols.length - 1] === x.c - 1) last.cols.push(x.c); else runs.push({ h: x.h, kind: x.kind, cols: [x.c] }); });
  const hasTitle = runs.some(x => x.kind === 'title');
  runs.forEach(x => {
    if (!x.kind || x.kind === 'no') return;
    if (x.cols.length > 1 && x.kind === 'name' && !hasTitle) { r.name = x.cols[0]; r.title = x.cols[1]; return; }
    if (x.cols.length > 1 && x.kind !== 'name' && !['tel', 'mobile', 'email', 'fax', 'note'].includes(x.kind)) { r.loc.push(...x.cols.slice(0, -1)); r[x.kind] = x.cols[x.cols.length - 1]; return; }
    if (Array.isArray(r[x.kind])) r[x.kind].push(...x.cols.map(c => ({ c, h: x.h })));
    else if (r[x.kind] == null) r[x.kind] = x.cols[0];
  });
  return r;
}

/** 시트 맨 위의 제목 칸 (회사 기본값 후보) */
function titleOf(rows, headAt) {
  for (let i = 0; i < headAt - 1; i++) for (const v of rows[i] || []) { const t = clean(v); if (t && t.length >= 4 && !/^0\d/.test(t)) return t; }
  return '';
}
/** 대표번호 앞자리 (예: '02-2230-') 가 시트에 있으면 내선 번호 앞에 붙인다 */
function prefixOf(rows, headAt) {
  for (let i = 0; i < headAt; i++) for (const v of rows[i] || []) { const t = clean(v); if (/^0\d{1,2}-\d{3,4}-$/.test(t)) return t; }
  return '';
}

/** 시트 하나 → { name, people: [...], skipped: 이유별 개수, title } */
export function parseSheet({ name, rows }) {
  const at = findHeader(rows);
  if (at < 0) return { name, people: [], ok: false, title: '' };
  const title = titleOf(rows, at), prefix = prefixOf(rows, at);
  const people = [];
  let noName = 0;
  for (const block of blocksOf(rows[at])) {
    const R = roles(block);
    for (let i = at + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const get = c => (c == null ? '' : clean(row[c]));
      const nm = get(R.name);
      if (!nm || kindOf(nm) === 'name') { if (!nm && block.cols.some(x => x.kind !== 'name' && get(x.c) && ['mobile', 'title'].includes(x.kind))) noName++; continue; }
      const flags = [];
      const phoneList = (list, mobile) => list.map(({ c, h }) => {
        const v = row[c];
        if (v === '' || v == null) return '';
        if (typeof v === 'number') {
          if (v < 0) { flags.push(`${h} 번호 확인 필요 (엑셀에서 수식으로 바뀜)`); return ''; }
          if (v < 100000 && !mobile) return prefix ? `${prefix}${v}` : `내선 ${v}`;
          return mobile ? normMobile(`0${v}`) : String(v);
        }
        const t = clean(v);
        return mobile ? normMobile(t) : t;
      }).filter(Boolean);
      const faxes = phoneList(R.fax, false);
      const rawMobiles = phoneList(R.mobile, true);
      // 칸이 밀려 휴대폰 칸에 이메일·일반 전화·팩스가 들어간 줄 바로잡기
      const moved = rawMobiles.filter(v => v.includes('@'));
      const mobiles = rawMobiles.filter(v => !v.includes('@') && !faxes.includes(v) && /^(01|\+?82)/.test(v.replace(/[^\d+]/g, '')));
      const tels = [...phoneList(R.tel, false), ...rawMobiles.filter(v => !v.includes('@') && !faxes.includes(v) && !mobiles.includes(v))];
      const emails = [...R.email.map(({ c }) => get(c)).filter(Boolean), ...moved].filter((x, k, a) => a.indexOf(x) === k);
      const check = get(R.check);
      const notes = [...R.note.map(({ c }) => get(c)), check, ...flags, ...R.loc.map(c => get(c) && `위치 ${get(c)}`)].filter(Boolean);
      const dept = [get(R.dept), get(R.team)].filter(Boolean).filter((x, k, a) => a.indexOf(x) === k).join(' ');
      people.push({
        name: nm, company: get(R.company), dept, title: get(R.title),
        phone: mobiles[0] || '', phone2: mobiles.slice(1).join(' / '),
        tel: tels.join(' / '), fax: faxes.join(' / '), email: emails[0] || '', email2: emails.slice(1).join(' / '),
        note: [...new Set(notes)].join(' · '), check: !!(check || flags.length), sheet: name,
      });
    }
  }
  return { name, people, ok: true, title, noName };
}

/** 파일 → 시트별 결과 */
export async function readContactBook(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw new Error('.xlsx 파일만 읽을 수 있습니다 (엑셀에서 "다른 이름으로 저장 › Excel 통합 문서")');
  return readXlsxBook(buf).map(parseSheet);
}

const FIELDS = ['company', 'dept', 'title', 'phone', 'phone2', 'tel', 'fax', 'email', 'email2'];
/** 빈 칸만 채워 합치기 (메모는 이어 붙임) */
export function fillBlanks(base, add) {
  const out = { ...base };
  FIELDS.forEach(k => { if (!out[k] && add[k]) out[k] = add[k]; });
  if (add.note && !(out.note || '').includes(add.note)) out.note = [out.note, add.note].filter(Boolean).join(' · ');
  if (add.check) out.check = true;
  return out;
}

/** 가져오기 계획: 파일 안 중복 합치기 + 기존 연락처와 비교
    sheets: parseSheet 결과 중 고른 것, opts: { company: {시트명: 기본 회사}, group }
    → { add: [새 사람], patch: [{ id, before, after }], merged: 파일 안에서 합친 수, same: 바뀔 것 없는 기존 수 } */
export function planImport(sheets, existing, { company = {}, group = '업무' } = {}) {
  const list = [], index = new Map();
  let merged = 0;
  for (const s of sheets) for (const raw of s.people) {
    const p = { ...raw, company: raw.company || company[s.name] || '' };
    const hit = personKeys(p).map(k => index.get(k)).find(x => x != null);
    if (hit != null) { list[hit] = fillBlanks(list[hit], p); list[hit].sheets.add(s.name); merged++; personKeys(list[hit]).forEach(k => index.set(k, hit)); continue; }
    const at = list.push({ ...p, sheets: new Set([s.name]) }) - 1;
    personKeys(p).forEach(k => index.set(k, at));
  }
  const old = new Map();
  existing.forEach(e => personKeys(e).forEach(k => { if (!old.has(k)) old.set(k, e); }));
  const add = [], patch = [];
  let same = 0;
  list.forEach(({ sheets: ss, sheet, ...p }) => {
    const src = [...ss].join(', ');
    const e = personKeys(p).map(k => old.get(k)).find(Boolean);
    if (e) {
      const after = fillBlanks(e, p);
      if (FIELDS.some(k => after[k] !== e[k]) || after.note !== e.note) patch.push({ id: e.id, before: e, after }); else same++;
      return;
    }
    add.push({ ...p, group, src, birthday: '', annivName: '', annivDate: '', address: '', card: '' });
  });
  return { add, patch, merged, same };
}

/** 회사 칸이 없는 시트의 기본 회사 추천: 같은 사람이 다른 시트에 있으면 그 회사 중 가장 많은 것, 없으면 시트 제목 */
export function suggestCompany(sheet, others) {
  if (sheet.people.some(p => p.company)) return '';
  const byKey = new Map();
  others.forEach(s => s.people.forEach(p => { if (p.company) personKeys(p).filter(k => k.startsWith('m:') || k.startsWith('e:')).forEach(k => byKey.set(k, p.company)); }));
  const cnt = {};
  sheet.people.forEach(p => { const c = personKeys(p).map(k => byKey.get(k)).find(Boolean); if (c) cnt[c] = (cnt[c] || 0) + 1; });
  const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : sheet.title;
}
