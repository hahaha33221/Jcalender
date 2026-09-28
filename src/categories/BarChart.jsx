import React, { useLayoutEffect, useRef, useState } from 'react';

/* 막대 그래프 (한 가지 값, 날짜별)
   data: [{ key, label(축), value, tip: [줄...], title(툴팁 제목) }]
   color: CSS 색 (예: 'var(--viz-ex)'), fmt: 값 표시 함수, goal: 목표선 값
   steps: 눈금 간격 후보 (예: 시간 단위면 [60, 120, 180]) */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const niceStep = (max, steps) => {
  const raw = max / 4;
  if (steps) return steps.find(s => s >= raw) || steps[steps.length - 1];
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw) || raw;
};

export default function BarChart({ data, color, fmt = v => v, tickFmt = fmt, goal, goalLabel, steps, height = 220, label }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);
  const P = { l: 40, r: goal > 0 ? 58 : 12, t: 18, b: 26 };   // 목표선 이름은 오른쪽 여백에 쓴다
  const iw = w - P.l - P.r, ih = height - P.t - P.b;
  const step = niceStep(Math.max(goal || 0, ...data.map(d => d.value), 1), steps);
  const max = Math.ceil(Math.max(goal || 0, ...data.map(d => d.value), 1) / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const n = data.length, col = iw / n, bw = Math.max(3, Math.min(26, col - 2));
  const y = v => P.t + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 42))));
  const lastIdx = data.map(d => d.value > 0).lastIndexOf(true);

  // 막대 위쪽만 둥근 모서리(4px), 아래는 기준선에 붙인다
  const bar = (x, v) => {
    const top = y(v), h = P.t + ih - top, r = Math.min(4, bw / 2, h);
    return `M${x},${P.t + ih}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${P.t + ih}Z`;
  };
  const hx = hover == null ? 0 : P.l + col * hover + col / 2;
  const hd = hover == null ? null : data[hover];

  return (
    <div className="bchart" ref={ref}>
      <svg width={w} height={height} role="img" aria-label={label}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={P.l} x2={w - P.r} y1={y(t)} y2={y(t)} className="bc-grid" />
            <text x={P.l - 6} y={y(t)} className="bc-tick" textAnchor="end" dominantBaseline="middle">{tickFmt(t)}</text>
          </g>
        ))}
        {hover != null && <rect x={P.l + col * hover} y={P.t} width={col} height={ih} className="bc-hl" />}
        {data.map((d, i) => d.value > 0 && (
          <path key={d.key} d={bar(P.l + col * i + (col - bw) / 2, d.value)} fill={color} opacity={hover == null || hover === i ? 1 : 0.55} />
        ))}
        {goal > 0 && (
          <g>
            <line x1={P.l} x2={w - P.r + 4} y1={y(goal)} y2={y(goal)} className="bc-goal" />
            <text x={w - P.r + 8} y={y(goal)} className="bc-goal-t" dominantBaseline="middle">{goalLabel}</text>
          </g>
        )}
        {lastIdx >= 0 && hover == null && (
          <text x={P.l + col * lastIdx + col / 2} y={y(data[lastIdx].value) - 6} className="bc-val" textAnchor="middle">{fmt(data[lastIdx].value)}</text>
        )}
        <line x1={P.l} x2={w - P.r} y1={P.t + ih} y2={P.t + ih} className="bc-base" />
        {data.map((d, i) => i % every === (n - 1) % every && (
          <text key={d.key} x={P.l + col * i + col / 2} y={height - 8} className="bc-tick" textAnchor="middle">{d.label}</text>
        ))}
        {data.map((d, i) => (
          <rect key={d.key} x={P.l + col * i} y={P.t} width={col} height={ih} fill="transparent" tabIndex={0}
            aria-label={`${d.title} ${d.value ? fmt(d.value) : '기록 없음'}`}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            onTouchStart={() => setHover(i)} className="bc-hit" />
        ))}
      </svg>
      {hd && (
        <div className="bc-tip" style={{ left: Math.min(Math.max(hx, 80), w - 80), top: Math.max(0, y(hd.value) - 10) }}>
          <b>{hd.title}</b>
          {hd.value ? hd.tip.map((t, i) => <span key={i}>{t}</span>) : <span className="muted">기록 없음</span>}
        </div>
      )}
    </div>
  );
}
