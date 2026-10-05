import { iso } from '../data.js';
import { TOOL_CONFIGS } from './toolConfigs.js';

/* 숏폼 4차 → 콘텐츠 관리 성과 탭 연결
   올린 영상(유튜브 · 인스타그램)을 콘텐츠 목록에 "발행"으로 넣고(id: sp-<업로드 id>), 가져온 성과를 store.content.perf 에 채운다
   - 사람이 고친 제목 · 계정 · 팔로워 유입 · 링크 클릭은 그대로 둔다 (자동으로 바꾸는 것은 조회 · 좋아요 · 댓글 · 공유 · 저장뿐)
   - 바뀐 것이 없으면 store 를 그대로 돌려줌 (동기화 안 늘어나게) */
const KEY = 'B|콘텐츠 관리';
const CH = { youtube: '유튜브', instagram: '인스타그램' };
const norm = s => String(s || '').replace(/^@/, '').trim().toLowerCase();

export function mergeShortsPosts(s, posts, channels = {}, now = new Date()) {
  const done = (posts || []).filter(p => p.status === 'done');
  if (!done.length) return s;
  const rows0 = s.tools?.[KEY] || TOOL_CONFIGS[KEY].seed(now);
  const rows = [...rows0];
  const perf = { ...(s.content?.perf || {}) };
  const accounts = (s.content?.accounts || []).filter(a => a.status !== '종료');
  let changed = !s.tools?.[KEY];
  for (const p of done) {
    const id = `sp-${p.id}`, channel = CH[p.platform];
    const mine = accounts.filter(a => a.channel === channel);
    const acc = mine.find(a => norm(a.name) && norm(a.name) === norm(channels[p.platform]?.name)) || (mine.length === 1 ? mine[0] : null);
    const i = rows.findIndex(r => r.id === id);
    if (i < 0) {
      rows.push({ id, title: p.title || '숏폼', channel, stage: '발행', date: iso(new Date(p.posted_at || p.created_at)), account: acc ? `${acc.channel} ${acc.name}` : '-', link: p.url, shortsPost: p.id });
      changed = true;
    } else if (p.url && rows[i].link !== p.url) { rows[i] = { ...rows[i], link: p.url }; changed = true; }
    if (p.stats_at && p.stats && Object.keys(p.stats).length) {
      const cur = perf[id] || {}, next = { ...cur };
      for (const k of ['views', 'likes', 'comments', 'shares', 'saves']) if (p.stats[k] != null) next[k] = Number(p.stats[k]);
      next.at = iso(new Date(p.stats_at));
      if (JSON.stringify(next) !== JSON.stringify(cur)) { perf[id] = next; changed = true; }
    }
  }
  if (!changed) return s;
  return { ...s, tools: { ...(s.tools || {}), [KEY]: rows }, content: { ...(s.content || {}), perf } };
}
