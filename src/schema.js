/* 저장 구조 버전 · 이전(마이그레이션) · 비밀 정보 분리 · 백업 (docs/ERD.md)
   store.meta = { schemaVersion, createdAt, migratedAt, lastBackupAt }
   새 테이블 (v2)
     categories:    [{ key: '영역|카테고리', area, name, order, hidden, hasGoal }]      카테고리 마스터
     projects:      [{ id, name, note, status: 진행|완료|보류, start, end, areas: [], updated }]  공통 프로젝트 (지출·기획·일정이 projectId 로 연결)
     tags:          [{ id, name, color }]                                               공통 태그 (일정·기획의 tagIds)
     attachments:   [{ id, owner: { type, id }, kind: link|onedrive, title, url, added }]   첨부 (링크 · OneDrive 경로)
     trash:         [{ id, type, label, data, extra, deletedAt }]                        휴지통 (30일 보관)
     notifications: [{ id, key, title, body, at, sentAt }]                               보낸 알림 기록
     notify:        { enabled, eventMinutes, planDays }                                  알림 설정
   기존 테이블 변경 (v2)
     finance.projects → projects 로 이동 (재무 화면은 useFinance 에서 합쳐 보여 준다)
     tools['W|업무 연락처'] → people (areas: ['W'], group: '업무') 로 합침
     anniv[].personId : 인맥의 사람과 연결 (관련 인물 글자가 이름과 같으면 자동 연결)
   비밀 정보(API 키 · 토큰)는 앱 데이터와 다른 키(jcalender.secrets)에 저장하고 백업에서 뺀다 */
import { ALL_ROWS, HIDDEN_CATS, iso } from './data.js';

export const SCHEMA_VERSION = 2;
export const SECRETS_KEY = 'jcalender.secrets';
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => iso(new Date());

/* ── 비밀 정보: 저장할 때 떼어 내고, 읽을 때 다시 붙인다 ── */
export function splitSecrets(s) {
  const sec = { cardAi: {}, feeds: {} };
  let out = s;
  if (s.cardAi && (s.cardAi.apiKey || s.cardAi.token)) {
    sec.cardAi = { apiKey: s.cardAi.apiKey || '', token: s.cardAi.token || '' };
    out = { ...out, cardAi: { ...s.cardAi, apiKey: '', token: '' } };
  }
  const feeds = s.plan?.feeds || [];
  if (feeds.some(f => f.token)) {
    feeds.forEach(f => { if (f.token) sec.feeds[f.id] = f.token; });
    out = { ...out, plan: { ...out.plan, feeds: feeds.map(f => ({ ...f, token: '' })) } };
  }
  return { data: out, secrets: sec };
}
export function mergeSecrets(s, sec) {
  if (!sec) return s;
  let out = s;
  if (sec.cardAi && (sec.cardAi.apiKey || sec.cardAi.token) && s.cardAi) out = { ...out, cardAi: { ...s.cardAi, apiKey: s.cardAi.apiKey || sec.cardAi.apiKey || '', token: s.cardAi.token || sec.cardAi.token || '' } };
  if (sec.feeds && s.plan?.feeds) out = { ...out, plan: { ...s.plan, feeds: s.plan.feeds.map(f => ({ ...f, token: f.token || sec.feeds[f.id] || '' })) } };
  return out;
}
export const readSecrets = () => { try { return JSON.parse(localStorage.getItem(SECRETS_KEY) || 'null'); } catch { return null; } };
export const writeSecrets = sec => { try { localStorage.setItem(SECRETS_KEY, JSON.stringify(sec)); } catch { /* 저장 불가 */ } };

/* ── 카테고리 마스터 ── */
export function buildCategories(prev = []) {
  const old = new Map(prev.map(c => [c.key, c]));
  const seen = new Map();
  ALL_ROWS.forEach(r => { const k = `${r.a}|${r.cat}`; if (!seen.has(k) && !HIDDEN_CATS.has(k)) seen.set(k, { key: k, area: r.a, name: r.cat }); });
  let i = 0;
  return [...seen.values()].map(c => {
    const o = old.get(c.key);
    return { ...c, order: o?.order ?? (c.key === 'P|개인 재무' ? 999 : i++), hidden: !!o?.hidden, hasGoal: o?.hasGoal ?? true };
  });
}

/* ── 단계별 이전 ── */
const MIGRATIONS = {
  // v1: 버전 정보 시작 (예전 한 번짜리 표시 financeCleared · annivV2 는 그대로 둔다)
  1: s => ({ ...s, meta: { createdAt: today(), ...(s.meta || {}) } }),
  // v2: 새 테이블 만들기 + 흩어진 데이터 합치기
  2: s => {
    const out = { ...s };
    out.categories = buildCategories(s.categories);
    // 프로젝트: 재무의 연계 프로젝트를 공통 표로
    const fp = s.finance?.projects || [];
    out.projects = [...(s.projects || []), ...fp.filter(p => !(s.projects || []).some(q => q.id === p.id))
      .map(p => ({ id: p.id, name: p.name, note: p.note || '', status: '진행', start: '', end: '', areas: ['P'], updated: p.updated || today() }))];
    if (s.finance) { const { projects, ...rest } = s.finance; out.finance = rest; }
    // 사람: 근로 › 업무 연락처 표를 인맥으로 (예시 줄 제외, 이름+번호가 같으면 합침)
    const wc = (s.tools?.['W|업무 연락처'] || []).filter(r => !/\(예시\)/.test(r.name || ''));
    if (wc.length) {
      const people = (s.people || []).map(p => ({ ...p }));
      const digits = v => String(v || '').replace(/\D/g, '').slice(-8);
      wc.forEach(r => {
        const hit = people.find(p => p.name === r.name && (!r.phone || digits(p.phone) === digits(r.phone)));
        if (hit) { hit.areas = [...new Set([...(hit.areas || []), 'W'])]; return; }
        people.push({ id: uid(), name: r.name, group: '업무', areas: ['W'], company: r.company || '', dept: '', title: r.dept || '', phone: r.phone || '', email: r.email || '',
          note: r.last ? `마지막 연락 ${r.last}` : '', birthday: '', annivName: '', annivDate: '', address: '', card: '', src: '업무 연락처' });
      });
      out.people = people;
    }
    if (out.tools?.['W|업무 연락처']) { const { ['W|업무 연락처']: _, ...rest } = out.tools; out.tools = rest; }
    // 기념일 ↔ 사람 연결
    out.anniv = (s.anniv || []).map(a => {
      if (a.personId || !a.person) return a;
      const p = (out.people || []).find(x => x.name === a.person || x.name.replace(/\s*\(.*\)$/, '') === a.person);
      return p ? { ...a, personId: p.id } : a;
    });
    out.tags = s.tags || [];
    out.attachments = s.attachments || [];
    out.trash = s.trash || [];
    out.notifications = s.notifications || [];
    out.notify = { enabled: false, eventMinutes: 10, planDays: 1, ...(s.notify || {}) };
    return out;
  },
};

/* ── 카테고리 이름 바꾸기 ──
   코드에서 카테고리 이름을 바꾸면 저장된 기록도 새 이름으로 옮긴다 (몇 번을 돌려도 같은 결과)
   카테고리 표 · 검수 표시 · 목표 보드 · 도구 기록 · 공부 기록 · 직접 만든 체크 항목 */
export const RENAMED = { 'B|콘텐츠/브랜드': 'B|콘텐츠 관리' };
export function renameCategories(s) {
  let out = s;
  const mv = o => {
    if (!o || typeof o !== 'object') return o;
    let r = o;
    Object.entries(RENAMED).forEach(([a, b]) => { if (a in r) { r = { ...r }; if (!(b in r)) r[b] = r[a]; delete r[a]; } });
    return r;
  };
  ['reviewed', 'tools', 'study'].forEach(k => { if (out[k] && Object.keys(RENAMED).some(a => a in out[k])) out = { ...out, [k]: mv(out[k]) }; });
  const bs = out.goals?.boards;
  if (bs && Object.keys(RENAMED).some(a => a in bs)) out = { ...out, goals: { ...out.goals, boards: mv(bs) } };
  const name = k => k.slice(k.indexOf('|') + 1);
  if (out.categories?.some(c => RENAMED[c.key])) {
    const have = new Set(out.categories.map(c => c.key));
    out = { ...out, categories: out.categories.flatMap(c => { const b = RENAMED[c.key]; if (!b) return [c]; return have.has(b) ? [] : [{ ...c, key: b, name: name(b) }]; }) };
  }
  const cu = out.checklist?.custom;
  if (cu?.some(r => RENAMED[`${r.a}|${r.cat}`])) out = { ...out, checklist: { ...out.checklist, custom: cu.map(r => { const b = RENAMED[`${r.a}|${r.cat}`]; return b ? { ...r, cat: name(b), item: r.item === r.cat ? name(b) : r.item } : r; }) } };
  return out;
}

/** 저장된 데이터를 현재 버전으로 올린다 (한 단계씩, 이미 올린 단계는 건너뜀) */
export function migrate(s) {
  let v = s.meta?.schemaVersion || 0, out = s;
  while (v < SCHEMA_VERSION) {
    v += 1;
    out = MIGRATIONS[v](out);
    out = { ...out, meta: { ...(out.meta || {}), schemaVersion: v, migratedAt: today() } };
  }
  out = renameCategories(out);
  // 2026-10-04 카테고리 검수 표시를 모두 미완료로 (한 번만): 다시 하나씩 검수한다
  if (!out.meta?.reviewReset) out = { ...out, reviewed: {}, meta: { ...(out.meta || {}), reviewReset: today() } };
  // 2026-10-04 체크리스트 새로 시작: 예전 체크리스트(기본 항목 · 직접 만든 항목)를 한 번 비우고 추천받기(온보딩)부터 시작 (체크 기록은 남김)
  if (!out.checklist?.v2) out = { ...out, checklist: { base: 'none', custom: [], v2: true } };
  // 코드에 카테고리가 새로 생기면 표에도 추가
  if (out.categories && out.categories.length !== buildCategories(out.categories).length) out = { ...out, categories: buildCategories(out.categories) };
  return out;
}

/* ── 휴지통 ── */
export const TRASH_TYPES = {
  event: { label: '일정', path: ['events'] },
  eventNote: { label: '일정 노트', path: ['eventNotes'] },
  person: { label: '인맥', path: ['people'] },
  anniv: { label: '기념일', path: ['anniv'] },
  dday: { label: 'D-day', path: ['ddays'] },
  plan: { label: '기획', path: ['plan', 'plans'] },
  topic: { label: '조사 주제', path: ['plan', 'topics'] },
  project: { label: '프로젝트', path: ['projects'] },
};
const getIn = (s, path) => path.reduce((o, k) => (o ? o[k] : undefined), s);
const setIn = (s, path, v) => (path.length === 1 ? { ...s, [path[0]]: v } : { ...s, [path[0]]: setIn(s[path[0]] || {}, path.slice(1), v) });
/** 항목을 휴지통으로 옮긴다: 원래 목록에서 빼고 trash 에 넣는다. extra 는 함께 지운 딸린 항목 (예: 조사 주제의 자료) */
export function toTrash(s, type, id, label, extra) {
  const path = TRASH_TYPES[type].path, list = getIn(s, path) || [];
  const item = list.find(x => x.id === id);
  if (!item) return s;
  let out = setIn(s, path, list.filter(x => x.id !== id));
  return { ...out, trash: [{ id: uid(), type, label: label || item.name || item.title || '', data: item, extra: extra || null, deletedAt: iso(new Date()) }, ...(out.trash || [])] };
}
export function restoreTrash(s, tid) {
  const t = (s.trash || []).find(x => x.id === tid);
  if (!t) return s;
  const path = TRASH_TYPES[t.type].path;
  let out = setIn(s, path, [...(getIn(s, path) || []).filter(x => x.id !== t.data.id), t.data]);
  if (t.type === 'topic' && t.extra?.sources) out = { ...out, plan: { ...out.plan, sources: [...(out.plan.sources || []), ...t.extra.sources] } };
  return { ...out, trash: out.trash.filter(x => x.id !== tid) };
}
/** 30일 지난 휴지통 항목 비우기 */
export function purgeTrash(s, days = 30) {
  const cut = new Date(); cut.setDate(cut.getDate() - days);
  const k = iso(cut);
  return (s.trash || []).some(t => t.deletedAt < k) ? { ...s, trash: s.trash.filter(t => t.deletedAt >= k) } : s;
}

/* ── 백업 ── */
/** 내보낼 JSON (비밀 정보 제외, 명함 이미지 포함) */
export function exportJson(s) {
  const { data } = splitSecrets(s);
  return JSON.stringify({ app: 'Jcalender', exportedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION, data }, null, 1);
}
/** 가져온 JSON 확인 → 현재 버전으로 올린 데이터 */
export function importJson(text) {
  const j = JSON.parse(text);
  const data = j && j.app === 'Jcalender' && j.data ? j.data : j;
  if (!data || typeof data !== 'object' || !('done' in data || 'events' in data)) throw new Error('Jcalender 백업 파일이 아닙니다');
  return migrate(data);
}
