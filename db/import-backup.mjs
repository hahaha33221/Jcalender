#!/usr/bin/env node
/* 앱 백업 파일(설정 › 백업 › 백업 파일 내려받기, jcalender_backup_YYYYMMDD.json) → PostgreSQL INSERT 문
   사용법:  node db/import-backup.mjs <백업.json> <이메일> [이름] > import.sql
           psql -d jcal -v ON_ERROR_STOP=1 -f import.sql
   - 사용자가 없으면 만들고(비밀번호는 로그인 기능에서 따로 설정), 있으면 그 사용자의 데이터를 갱신한다 (같은 id 는 덮어씀)
   - 한 트랜잭션으로 실행되어 중간에 실패하면 아무것도 바뀌지 않는다
   - 비밀 정보(API 키 · 토큰)는 백업 파일에 없으므로 옮기지 않는다 */
import fs from 'fs';

const [, , file, email, name = ''] = process.argv;
if (!file || !email) { console.error('사용법: node db/import-backup.mjs <백업.json> <이메일> [이름]'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const S = raw.app === 'Jcalender' ? raw.data : raw;

/* ── SQL 값 만들기 ── */
const q = v => {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v) === v ? v : v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const qs = v => `'${String(v ?? '').replace(/'/g, "''")}'`;             // 빈 글자도 '' 로
const qd = v => (/^\d{4}-\d{2}-\d{2}/.test(v || '') ? q(v.slice(0, 10)) : 'NULL');   // 날짜
const qt = v => (/^\d{2}:\d{2}/.test(v || '') ? q(v.slice(0, 5)) : 'NULL');         // 시각
const qj = v => (v === undefined || v === null ? 'NULL' : `${qs(JSON.stringify(v))}::jsonb`);
const qa = arr => `ARRAY[${(arr || []).map(qs).join(',')}]::text[]`;
const qc = arr => `ARRAY[${(arr || []).map(qs).join(',')}]::char(1)[]`;
const qn = v => (v === '' || v == null || Number.isNaN(Number(v)) ? 'NULL' : String(Math.round(Number(v))));
const okId = v => (v && /^[A-Za-z0-9_@:.-]{1,40}$/.test(String(v)) ? String(v) : null);
const U = 'u.id';                                                          // 아래 WITH 절의 사용자

const out = [];
const emit = s => out.push(s);
/** INSERT … ON CONFLICT 기본 키 DO UPDATE */
function upsert(table, cols, rows, key = ['user_id', 'id']) {
  if (!rows.length) return;
  const upd = cols.filter(c => !key.includes(c)).map(c => `${c} = EXCLUDED.${c}`).join(', ');
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map(r => `(${r.join(', ')})`).join(',\n  ');
    emit(`INSERT INTO jcal.${table} (${cols.join(', ')}) VALUES\n  ${chunk}\nON CONFLICT (${key.join(', ')}) DO ${upd ? `UPDATE SET ${upd}` : 'NOTHING'};`);
  }
}
const uid = `(SELECT id FROM jcal.users WHERE email = ${qs(email)})`;

emit('BEGIN;');
emit(`INSERT INTO jcal.users (email, name, password_hash) VALUES (${qs(email)}, ${qs(name)}, '!not-set') ON CONFLICT (email) DO NOTHING;`);

/* 설정 */
const meta = S.meta || {};
emit(`INSERT INTO jcal.user_settings (user_id, schema_version, check_rules, anniv_days, notify_enabled, notify_event_min, notify_plan_days, card_ai, onedrive, board_view, ui, last_backup_at)
VALUES (${uid}, ${qn(meta.schemaVersion) || 2}, ${qj(S.rules || {})}, ${qn(S.annivDays) === 'NULL' ? 10 : qn(S.annivDays)}, ${q(!!S.notify?.enabled)}, ${qn(S.notify?.eventMinutes ?? 10)}, ${qn(S.notify?.planDays ?? 1)},
  ${qj({ mode: S.cardAi?.mode || 'off', endpoint: S.cardAi?.endpoint || '', model: S.cardAi?.model || '' })}, ${qj(S.onedrive || {})}, ${qj(S.boardView || {})}, ${qj({ finance: S.finance?.ui || null, plan: S.plan?.ui || null })}, NULL)
ON CONFLICT (user_id) DO UPDATE SET schema_version = EXCLUDED.schema_version, check_rules = EXCLUDED.check_rules, anniv_days = EXCLUDED.anniv_days, notify_enabled = EXCLUDED.notify_enabled,
  notify_event_min = EXCLUDED.notify_event_min, notify_plan_days = EXCLUDED.notify_plan_days, card_ai = EXCLUDED.card_ai, onedrive = EXCLUDED.onedrive, board_view = EXCLUDED.board_view, ui = EXCLUDED.ui;`);

/* 카테고리 · 체크 */
upsert('categories', ['user_id', 'key', 'area', 'name', 'sort_order', 'hidden', 'has_goal', 'reviewed_on'],
  (S.categories || []).map(c => [uid, qs(c.key), qs(c.area), qs(c.name), qn(c.order) === 'NULL' ? 0 : qn(c.order), q(!!c.hidden), q(c.hasGoal !== false), qd(S.reviewed?.[c.key])]), ['user_id', 'key']);
upsert('check_done', ['user_id', 'row_id', 'period', 'done_at'],
  Object.entries(S.done || {}).map(([k, v]) => { const [row, per] = k.split('@'); return [uid, qs(row), qs(per || ''), v?.at ? `${qs(v.at.replace(' ', 'T'))}::timestamptz` : 'now()']; }), ['user_id', 'row_id', 'period']);
const prefRows = [...new Set([...Object.keys(S.prio || {}), ...Object.keys(S.outs || {})])];
upsert('check_prefs', ['user_id', 'row_id', 'prio', 'output', 'memo'],
  prefRows.map(r => [uid, qs(r), qn(S.prio?.[r]), qj(S.outs?.[r] ?? null), q(S.outs?.[r]?.memo)]), ['user_id', 'row_id']);

/* 공통 */
upsert('projects', ['user_id', 'id', 'name', 'note', 'status', 'start_date', 'end_date', 'areas'],
  (S.projects || []).filter(p => okId(p.id)).map(p => [uid, qs(p.id), qs(p.name), qs(p.note), qs(['진행', '보류', '완료'].includes(p.status) ? p.status : '진행'), qd(p.start), qd(p.end), qc(p.areas?.length ? p.areas : ['P'])]));
upsert('tags', ['user_id', 'id', 'name', 'color'], (S.tags || []).filter(t => okId(t.id)).map(t => [uid, qs(t.id), qs(t.name), qs(t.color || '#4a5563')]));
upsert('attachments', ['user_id', 'id', 'owner_type', 'owner_id', 'kind', 'title', 'url', 'added_on'],
  (S.attachments || []).filter(a => okId(a.id) && okId(a.owner?.id) && ['event', 'plan'].includes(a.owner?.type)).map(a => [uid, qs(a.id), qs(a.owner.type), qs(a.owner.id), qs(a.kind === 'link' ? 'link' : 'onedrive'), qs(a.title), qs(a.url), qd(a.added) === 'NULL' ? 'current_date' : qd(a.added)]));
upsert('notifications', ['user_id', 'key', 'title', 'body', 'at', 'sent_at'],
  (S.notifications || []).map(n => [uid, qs(n.key), qs(n.title), q(n.body), `${qs((n.at || '').replace(' ', 'T') || new Date().toISOString())}::timestamptz`, `${qs(n.sentAt || new Date().toISOString())}::timestamptz`]), ['user_id', 'key']);

/* 캘린더 */
const projIds = new Set((S.projects || []).map(p => p.id));
const pid = v => (v && projIds.has(v) ? qs(v) : 'NULL');
const events = (S.events || []).filter(e => okId(e.id) && e.date);
upsert('events', ['user_id', 'id', 'date', 'time', 'title', 'area', 'memo', 'project_id', 'remind_min', 'repeat_freq', 'repeat_until'],
  events.map(e => [uid, qs(e.id), qd(e.date), qt(e.time), qs(e.title), qs(e.area || 'P'), qs(e.memo), pid(e.projectId), e.remind === 'off' ? '-1' : qn(e.remind), q(e.repeat?.freq || null), qd(e.repeat?.until)]));
upsert('event_skips', ['user_id', 'event_id', 'occ_date'],
  events.flatMap(e => (e.repeat?.skip || []).map(d => [uid, qs(e.id), qd(d)])), ['user_id', 'event_id', 'occ_date']);
const tagIds = new Set((S.tags || []).map(t => t.id));
upsert('event_tags', ['user_id', 'event_id', 'tag_id'],
  events.flatMap(e => (e.tagIds || []).filter(t => tagIds.has(t)).map(t => [uid, qs(e.id), qs(t)])), ['user_id', 'event_id', 'tag_id']);
upsert('event_notes', ['user_id', 'id', 'title', 'area', 'time', 'memo'],
  (S.eventNotes || []).filter(n => okId(n.id)).map(n => [uid, qs(n.id), qs(n.title), qs(n.area || 'P'), qt(n.time), qs(n.memo)]));

/* 인맥 · 기념일 · D-day */
const imp = S.peopleImport;
if (imp && okId(imp.id)) upsert('people_imports', ['user_id', 'id', 'file', 'detail'], [[uid, qs(imp.id), q(imp.file), qj({ added: imp.added, at: imp.at })]]);
const GRP = ['가족', '친구', '동료', '지인', '업무'];
const people = (S.people || []).filter(p => okId(p.id));
upsert('people', ['user_id', 'id', 'name', 'grp', 'areas', 'company', 'dept', 'title', 'phone', 'phone2', 'tel', 'fax', 'email', 'email2', 'address', 'birthday', 'anniv_name', 'anniv_date', 'card_url', 'note', 'needs_check', 'src', 'import_id'],
  people.map(p => [uid, qs(p.id), qs(p.name), qs(GRP.includes(p.group) ? p.group : '지인'), qc(Array.isArray(p.areas) ? p.areas : p.group === '업무' || p.importId ? ['W'] : ['P']),
    qs(p.company), qs(p.dept), qs(p.title), qs(p.phone), qs(p.phone2), qs(p.tel), qs(p.fax), qs(p.email), qs(p.email2), qs(p.address), qd(p.birthday), qs(p.annivName), qd(p.annivDate),
    p.card && !p.card.startsWith('data:') ? qs(p.card) : 'NULL', qs(p.note), q(!!p.check), qs(p.src), imp && p.importId === imp.id ? qs(p.importId) : 'NULL']));
const personIds = new Set(people.map(p => p.id));
upsert('anniversaries', ['user_id', 'id', 'name', 'person_text', 'person_id', 'date', 'kind', 'yearly', 'lunar', 'leap', 'no_year'],
  (S.anniv || []).filter(a => okId(a.id) && a.date).map(a => [uid, qs(a.id), qs(a.name), qs(a.person), a.personId && personIds.has(a.personId) ? qs(a.personId) : 'NULL', qd(a.date), qs(a.kind === '기념일' ? '기념일' : '생일'), q(a.yearly !== false), q(!!a.lunar), q(!!a.leap && !!a.lunar), q(!!a.noYear)]));
upsert('ddays', ['user_id', 'id', 'name', 'date', 'mode', 'start_one', 'pin', 'memo'],
  (S.ddays || []).filter(d => okId(d.id)).map(d => [uid, qs(d.id), qs(d.name), qd(d.date), qs(d.mode === 'since' ? 'since' : 'until'), q(d.startOne !== false), q(d.pin !== false), qs(d.memo)]));

/* 개인 재무 */
const F = S.finance || {};
emit(`INSERT INTO jcal.finance_settings (user_id, monthly_budget, card_installment, report_next) VALUES (${uid}, ${qn(F.budget) === 'NULL' ? 0 : qn(F.budget)}, ${qs(F.cardInstallment === 'use' ? 'use' : 'bill')}, ${qs(F.report?.next)})
ON CONFLICT (user_id) DO UPDATE SET monthly_budget = EXCLUDED.monthly_budget, card_installment = EXCLUDED.card_installment, report_next = EXCLUDED.report_next;`);
upsert('expense_categories', ['user_id', 'name', 'budget', 'keywords', 'sort_order'],
  (F.cats || []).map((c, i) => [uid, qs(c.name), qn(c.budget) === 'NULL' ? 0 : qn(c.budget), qa(c.keywords), String(i)]), ['user_id', 'name']);
const imports = (F.imports || []).filter(x => okId(x.id));
upsert('card_imports', ['user_id', 'id', 'at', 'files', 'added', 'total', 'months'],
  imports.map(x => [uid, qs(x.id), `${qs((x.at || '').replace(' ', 'T') || new Date().toISOString())}::timestamptz`, qj(x.files || []), qn(x.added) === 'NULL' ? 0 : qn(x.added), qn(x.sum) === 'NULL' ? 0 : qn(x.sum), qj(x.months || {})]));
const shop = (F.shopping || []).filter(x => okId(x.id));
upsert('shopping_items', ['user_id', 'id', 'name', 'qty', 'price', 'cat', 'added_on', 'bought_on', 'paid'],
  shop.map(x => [uid, qs(x.id), qs(x.name), qn(x.qty) === 'NULL' ? 1 : qn(Math.max(1, x.qty)), qn(x.price) === 'NULL' ? 0 : qn(x.price), qs(x.cat || '생활용품'), qd(x.added) === 'NULL' ? 'current_date' : qd(x.added), qd(x.bought), qn(x.paid)]));
const impIds = new Set(imports.map(x => x.id)), shopIds = new Set(shop.map(x => x.id));
upsert('expenses', ['user_id', 'id', 'date', 'amount', 'cat', 'memo', 'card', 'project_id', 'import_id', 'shopping_id'],
  (F.expenses || []).filter(e => okId(e.id) && e.date).map(e => [uid, qs(e.id), qd(e.date), qn(e.amount) === 'NULL' ? 0 : qn(e.amount), qs(e.cat || '기타'), qs((e.memo || '').slice(0, 300)), q(e.card), pid(e.projectId), impIds.has(e.importId) ? qs(e.importId) : 'NULL', shopIds.has(e.shopId) ? qs(e.shopId) : 'NULL']));
const fixed = (F.incomeFixed || []).filter(x => okId(x.id));
upsert('income_fixed', ['user_id', 'id', 'cat', 'source', 'amount', 'day'], fixed.map(x => [uid, qs(x.id), qs(x.cat), qs(x.source), qn(x.amount) === 'NULL' ? 0 : qn(x.amount), String(Math.min(31, Math.max(1, Number(x.day) || 1)))]));
const fixedIds = new Set(fixed.map(x => x.id));
upsert('incomes', ['user_id', 'id', 'date', 'amount', 'cat', 'source', 'memo', 'fixed_id'],
  (F.incomes || []).filter(x => okId(x.id) && x.date).map(x => [uid, qs(x.id), qd(x.date), qn(x.amount) === 'NULL' ? 0 : qn(x.amount), qs(x.cat || '기타'), qs(x.source), qs(x.memo), fixedIds.has(x.fixedId) ? qs(x.fixedId) : 'NULL']));

/* 건강 */
const H = S.health || {};
emit(`INSERT INTO jcal.health_settings (user_id, goal_sleep, goal_kcal, imported) VALUES (${uid}, ${qn(H.goalSleep) === 'NULL' ? 420 : qn(H.goalSleep)}, ${qn(H.goalKcal) === 'NULL' ? 2000 : qn(H.goalKcal)}, ${qj(H.imported ?? null)})
ON CONFLICT (user_id) DO UPDATE SET goal_sleep = EXCLUDED.goal_sleep, goal_kcal = EXCLUDED.goal_kcal, imported = EXCLUDED.imported;`);
upsert('workouts', ['user_id', 'id', 'date', 'type', 'minutes', 'kcal'], (H.workouts || []).filter(x => okId(x.id)).map(x => [uid, qs(x.id), qd(x.date), qs(x.type), qn(x.minutes) === 'NULL' ? 0 : qn(x.minutes), qn(x.kcal)]));
upsert('sleep_logs', ['user_id', 'id', 'date', 'bed', 'wake'], (H.sleep || []).filter(x => okId(x.id) && x.bed && x.wake).map(x => [uid, qs(x.id), qd(x.date), qt(x.bed), qt(x.wake)]));
upsert('meals', ['user_id', 'id', 'date', 'meal', 'name', 'kcal', 'src'], (H.meals || []).filter(x => okId(x.id)).map(x => [uid, qs(x.id), qd(x.date), qs(x.meal), qs(x.name), qn(x.kcal), q(x.src)]));
upsert('clinic_visits', ['user_id', 'id', 'date', 'hospital', 'dept', 'note', 'rx', 'next_on'], (H.visits || []).filter(x => okId(x.id)).map(x => [uid, qs(x.id), qd(x.date), qs(x.hospital), q(x.dept), q(x.note), q(x.rx), qd(x.next)]));

/* 목표 (부모가 먼저 들어가도록 깊이 순서로) */
const goalRows = [], mileRows = [];
for (const [ck, b] of Object.entries(S.goals?.boards || {})) {
  const items = (b.items || []).filter(i => okId(i.id) && i.start && i.end);
  const ids = new Set(items.map(i => i.id));
  const depth = i => { let d = 0, p = i.parent; while (p && d < 10) { d++; p = items.find(x => x.id === p)?.parent; } return d; };
  items.map((i, k) => ({ i, k, d: depth(i) })).sort((a, b) => a.d - b.d).forEach(({ i, k }) =>
    goalRows.push([uid, qs(i.id), qs(ck), i.parent && ids.has(i.parent) ? qs(i.parent) : 'NULL', qs(i.name), qd(i.start), qd(i.end < i.start ? i.start : i.end), qn(i.progress), q(i.link || null), String(k)]));
  (b.miles || []).filter(m => okId(m.id) && m.date).forEach(m => mileRows.push([uid, qs(m.id), qs(ck), m.link && ids.has(m.link) ? qs(m.link) : 'NULL', qs(m.name), qd(m.date), q(!!m.done)]));
}
upsert('goal_items', ['user_id', 'id', 'cat_key', 'parent_id', 'name', 'start_date', 'end_date', 'progress', 'link_row', 'sort_order'], goalRows);
upsert('milestones', ['user_id', 'id', 'cat_key', 'item_id', 'name', 'date', 'done'], mileRows);

/* 기획 · 조사 */
const P = S.plan || {};
const topics = (P.topics || []).filter(t => okId(t.id));
upsert('research_topics', ['user_id', 'id', 'title', 'purpose', 'due', 'status', 'summary'],
  topics.map(t => [uid, qs(t.id), qs(t.title), qs(t.purpose), qd(t.due), qs(t.status === '정리 완료' ? '정리 완료' : '조사 중'), qs(t.summary)]));
const topicIds = new Set(topics.map(t => t.id));
upsert('research_sources', ['user_id', 'id', 'topic_id', 'title', 'url', 'source', 'date', 'memo', 'tags', 'star'],
  (P.sources || []).filter(s => okId(s.id) && topicIds.has(s.topicId)).map(s => [uid, qs(s.id), qs(s.topicId), qs(s.title), qs(s.url), qs(s.from), qd(s.date), qs(s.memo), qa(s.tags), String(Math.min(3, Math.max(1, Number(s.star) || 2)))]));
const feeds = (P.feeds || []).filter(f => okId(f.id));
upsert('plan_feeds', ['user_id', 'id', 'name', 'url', 'header', 'field_map', 'last_sync', 'item_count'],
  feeds.map(f => [uid, qs(f.id), qs(f.name || f.url), qs(f.url), qs(f.header || 'Authorization'), qj(f.map || {}), qd(f.lastSync), qn(f.count) === 'NULL' ? 0 : qn(f.count)]));
const feedIds = new Set(feeds.map(f => f.id));
const STAT = ['아이디어', '초안', '검토', '확정', '보류'];
const plans = (P.plans || []).filter(p => okId(p.id));
upsert('plans', ['user_id', 'id', 'title', 'status', 'due', 'project_id', 's1_overview', 's2_agenda', 's3_detail', 's4_result', 's5_next', 's6_etc', 'ext_feed_id', 'ext_key'],
  plans.map(p => [uid, qs(p.id), qs(p.title), qs(STAT.includes(p.status) ? p.status : '아이디어'), qd(p.due), pid(p.projectId),
    qs(p.sec?.s1), qs(p.sec?.s2), qs(p.sec?.s3), qs(p.sec?.s4), qs(p.sec?.s5), qs(p.sec?.s6), feedIds.has(p.ext?.feed) ? qs(p.ext.feed) : 'NULL', p.ext?.key ? qs(p.ext.key) : 'NULL']));
upsert('plan_topics', ['user_id', 'plan_id', 'topic_id'], plans.flatMap(p => (p.topicIds || []).filter(t => topicIds.has(t)).map(t => [uid, qs(p.id), qs(t)])), ['user_id', 'plan_id', 'topic_id']);
upsert('plan_tags', ['user_id', 'plan_id', 'tag_id'], plans.flatMap(p => (p.tagIds || []).filter(t => tagIds.has(t)).map(t => [uid, qs(p.id), qs(t)])), ['user_id', 'plan_id', 'tag_id']);

/* 도구 기록 · 저널링 · 학습 · 앱 연동 */
upsert('tool_records', ['user_id', 'id', 'cat_key', 'data'],
  Object.entries(S.tools || {}).flatMap(([ck, rows]) => (rows || []).filter(r => okId(r.id)).map(r => { const { id, ...data } = r; return [uid, qs(`${id}`), qs(ck), qj(data)]; })));
const J = S.journal || {};
upsert('journal_entries', ['user_id', 'id', 'date', 'mood', 'text', 'tags'],
  (J.entries || []).filter(e => okId(e.id) && e.date).map(e => [uid, qs(e.id), qd(e.date), String(Math.min(5, Math.max(1, Number(e.mood) || 3))), qs(e.text), qa(e.tags)]));
upsert('week_reviews', ['user_id', 'id', 'week', 'keep', 'problem', 'try_next', 'saved_on'],
  (J.reviews || []).filter(r => okId(r.id) && r.week).map(r => [uid, qs(r.id), qs(r.week), qs(r.keep), qs(r.problem), qs(r.tryNext), qd(r.saved)]));
for (const [ck, st] of Object.entries(S.study || {})) {
  upsert('study_subjects', ['user_id', 'id', 'cat_key', 'name', 'target_min'], (st.subjects || []).filter(x => okId(x.id)).map(x => [uid, qs(x.id), qs(ck), qs(x.name), qn(x.target) === 'NULL' ? 0 : qn(x.target)]));
  upsert('study_logs', ['user_id', 'id', 'cat_key', 'date', 'subject', 'minutes', 'memo'], (st.logs || []).filter(x => okId(x.id) && x.date).map(x => [uid, qs(x.id), qs(ck), qd(x.date), qs(x.subject), qn(x.minutes) === 'NULL' ? 0 : qn(x.minutes), qs(x.memo)]));
}
upsert('learn_apps', ['user_id', 'key', 'app_name', 'open_url', 'data_url', 'data', 'synced_at'],
  Object.entries(S.learn || {}).map(([k, a]) => [uid, qs(k), q(a.appName), q(a.openUrl), q(a.dataUrl), qj(a.data ?? null), a.syncedAt ? `${qs(String(a.syncedAt).replace(' ', 'T'))}::timestamptz` : 'NULL']), ['user_id', 'key']);

emit('COMMIT;');
process.stdout.write(out.join('\n') + '\n');
console.error(`변환 완료: 일정 ${events.length} · 인맥 ${people.length} · 기념일 ${(S.anniv || []).length} · 지출 ${(F.expenses || []).length} · 기획 ${plans.length} · 체크 ${Object.keys(S.done || {}).length}`);
