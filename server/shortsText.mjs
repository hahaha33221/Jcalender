/* 숏폼: 화면(src)과 서버가 함께 쓰는 규칙 — 영상 설정 기본값 · 범위, 자막 나누기, 길이 계산, 소재 자동 고르기
   (의존성 없음: 앱은 ../../server/shortsText.mjs 로 불러 쓴다) */

export const MOODS = ['잔잔', '밝음', '긴장', '슬픔', '웃김', '감동', '공포', '신남'];
/** 자막 글꼴 (3차에서 서버에 같은 글꼴을 설치해 영상에 씀, 모두 무료 OFL) */
export const FONTS = [
  ['Noto Sans KR', '본고딕 (기본)'], ['Black Han Sans', '검은고딕 (굵고 강함)'], ['Do Hyeon', '도현'], ['Jua', '주아 (둥글둥글)'],
  ['Nanum Gothic', '나눔고딕'], ['Nanum Myeongjo', '나눔명조'], ['Nanum Pen Script', '나눔손글씨 펜'],
];
/** 나레이션 목소리 (OpenAI TTS) */
export const VOICES = [
  ['nova', '노바 · 밝은 여성'], ['shimmer', '쉬머 · 부드러운 여성'], ['coral', '코랄 · 따뜻한 여성'], ['sage', '세이지 · 차분한'],
  ['alloy', '알로이 · 중성적'], ['ash', '애쉬 · 또렷한 남성'], ['echo', '에코 · 낮은 남성'], ['onyx', '오닉스 · 굵은 남성'], ['fable', '페이블 · 이야기꾼'],
];
export const DEFAULT_VIDEO = {
  clipSeconds: 4,          // 배경 하나가 나오는 시간 (초)
  fit: 'cover',            // cover: 세로 화면을 꽉 채우게 자름 · blur: 전체가 보이게 + 뒤는 흐린 배경
  voice: 'nova',
  speed: 1.1,              // 나레이션 빠르기
  musicVolume: 15,         // 배경음악 크기 (%), 나레이션 중에는 자동으로 더 작게
  showTitle: true,         // 화면 위쪽에 제목 고정
  sub: { font: 'Noto Sans KR', size: 72, color: '#FFFFFF', stroke: '#000000', strokeWidth: 6, box: false, boxColor: '#000000', boxOpacity: 55,
    position: 'middle', lineChars: 14, maxLines: 2, highlight: '#FFE600' },
};
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toUpperCase() : d);
const num = (v, lo, hi, d, step = 1) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n / step) * step)) : d; };
export function clampVideo(v) {
  const x = { ...DEFAULT_VIDEO, ...(v || {}) }, s = { ...DEFAULT_VIDEO.sub, ...(x.sub || {}) }, D = DEFAULT_VIDEO.sub;
  return {
    clipSeconds: num(x.clipSeconds, 1.5, 20, 4, 0.5), fit: x.fit === 'blur' ? 'blur' : 'cover',
    voice: VOICES.some(([k]) => k === x.voice) ? x.voice : 'nova', speed: num(x.speed, 0.7, 1.5, 1.1, 0.05),
    musicVolume: num(x.musicVolume, 0, 60, 15), showTitle: x.showTitle !== false,
    sub: { font: FONTS.some(([k]) => k === s.font) ? s.font : D.font, size: num(s.size, 36, 120, D.size), color: hex(s.color, D.color), stroke: hex(s.stroke, D.stroke),
      strokeWidth: num(s.strokeWidth, 0, 16, D.strokeWidth), box: !!s.box, boxColor: hex(s.boxColor, D.boxColor), boxOpacity: num(s.boxOpacity, 0, 100, D.boxOpacity),
      position: ['top', 'middle', 'bottom'].includes(s.position) ? s.position : D.position, lineChars: num(s.lineChars, 6, 30, D.lineChars), maxLines: num(s.maxLines, 1, 3, D.maxLines),
      highlight: hex(s.highlight, D.highlight) },
  };
}

/** 나레이션 길이 추정 (초): 한국어 약 5.5자/초 ÷ 빠르기 — 3차에서는 실제 음성 길이를 씀 */
export const estSeconds = (text, speed = 1) => Math.max(1, Math.round(String(text || '').replace(/\s+/g, '').length / 5.5 / (speed || 1) * 1.1));
/** 필요한 배경 개수 = 나레이션 길이 ÷ 배경 하나 시간 */
export const clipsNeeded = (secs, clipSeconds) => Math.max(1, Math.ceil(secs / Math.max(1, clipSeconds)));

/** 자막 나누기: 문장 → 한 줄 lineChars 자 · 한 화면 maxLines 줄 (띄어쓰기에서 끊고, 너무 긴 낱말은 자름)
    → [[줄, 줄], [줄], …] (화면 하나 = 배열 하나) */
export function splitSubs(text, lineChars = 14, maxLines = 2) {
  const sentences = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?。…~])\s+|(?<=[다요죠까네])\.?\s+(?=[A-Z가-힣"“'‘(])/u).filter(Boolean);
  const screens = [];
  for (const sen of sentences) {
    const lines = [];
    let cur = '';
    for (const w0 of sen.split(' ')) {
      let w = w0;
      while (w.length > lineChars) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, lineChars)); w = w.slice(lineChars); }
      if (!w) continue;
      if (!cur) cur = w; else if (cur.length + 1 + w.length <= lineChars) cur += ` ${w}`; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    for (let i = 0; i < lines.length; i += maxLines) screens.push(lines.slice(i, i + maxLines));
  }
  return screens;
}

/** 소재 자동 고르기: 검색어 · 분위기와 겹치는 태그 · 이름을 먼저, 모자라면 나머지에서 (같은 소재는 되도록 안 겹치게)
    assets: [{ id, kind, name, tags, duration }] → { backgrounds: [id…], musicId } */
export function autoPick(assets, { need, keywords = '', mood = '', clipSeconds = 4 }) {
  const words = `${keywords} ${mood}`.toLowerCase().split(/[\s,]+/).filter(w => w.length > 1);
  const score = a => { const t = `${a.name} ${a.tags}`.toLowerCase(); return words.reduce((s, w) => s + (t.includes(w) ? 2 : 0), 0) + (a.kind === 'video' && Number(a.duration) >= clipSeconds ? 1 : 0); };
  const bg = assets.filter(a => a.kind === 'video' || a.kind === 'image').map(a => ({ a, s: score(a) + Math.random() * 0.5 })).sort((x, y) => y.s - x.s).map(x => x.a.id);
  const backgrounds = [];
  for (let i = 0; bg.length && i < need; i++) backgrounds.push(bg[i % bg.length]);
  const music = assets.filter(a => a.kind === 'music').map(a => ({ a, s: (mood && `${a.tags} ${a.name}`.includes(mood) ? 3 : 0) + Math.random() })).sort((x, y) => y.s - x.s);
  return { backgrounds, musicId: music[0]?.a.id || null };
}
