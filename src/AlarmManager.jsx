import React, { useMemo, useState } from 'react';
import { iso } from './data.js';
import { WEEK, useCtx } from './shared.jsx';
import { repeatText } from './recur.js';
import { ownAlarm, remindLabel, remindMinutes, upcomingAlarms } from './notify.js';
import { Notify } from './DataSettings.jsx';

/* 알람 관리: 알람을 한곳에서 보고 고친다
   - 다가오는 알람: 7일 안에 울릴 알람(루틴 · 알람 · 일정 · 목표 마감 · 기획 마감 · 저널링)을 시간순으로 (notify.js upcomingAlarms)
   - 알람 목록: 루틴 · 알람 · 알림 시점을 따로 정한 일정 — 시각 · 알림 시점 바꾸기 · 끄기 · (알람은) 삭제
     루틴을 고치면 체크리스트의 그 루틴도 함께 (시각 · 5분 전 알림)
   - 알람 추가: 루틴과 따로 알람만 (한 번 · 매일 · 평일 · 주말 · 특정 요일) → events 에 alarm: true 로 들어감 (캘린더에도 보임)
   - 기본 알림 설정 · 알림음 · 푸시 · 보낸 기록 (DataSettings.jsx 의 Notify) */
const uid = () => Math.random().toString(36).slice(2, 10);
const REMINDS = [['off', '끄기'], ['0', '정각'], ['5', '5분 전'], ['10', '10분 전'], ['30', '30분 전'], ['60', '1시간 전'], ['1440', '하루 전']];
const KIND = { routine: '루틴', alarm: '알람', event: '일정', goal: '목표 마감', plan: '기획 마감', journal: '저널링' };
const REP = [['once', '한 번'], ['D', '매일'], ['wd', '평일'], ['we', '주말'], ['days', '특정 요일']];
const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function AlarmManager() {
  const { store, setStore, now, openCat } = useCtx();
  const today = iso(now);
  const N = store.notify || {};
  const [f, setF] = useState('all');
  const [form, setForm] = useState({ title: '', time: '07:00', rep: 'D', date: today, days: [1, 3, 5], remind: '0' });
  const [msg, setMsg] = useState('');

  const up = useMemo(() => upcomingAlarms(store, new Date(), 7), [store.events, store.notify, store.goals, store.plan, store.journal]);
  const groups = [];
  up.forEach(a => { const k = iso(a.when); let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, list: [] }); g.list.push(a); });
  const dayName = k => { const d = new Date(`${k}T00:00:00`), diff = Math.round((d - new Date(`${today}T00:00:00`)) / 864e5); return `${diff === 0 ? '오늘' : diff === 1 ? '내일' : `${d.getMonth() + 1}/${d.getDate()}`} (${WEEK[d.getDay()]})`; };

  // 알람 목록: 루틴 · 알람 · 알림 시점을 따로 정한 일정 (시간 있는 것)
  const list = (store.events || []).filter(e => e.time && (e.routine || e.alarm || (e.remind !== '' && e.remind != null)))
    .filter(e => f === 'all' || (f === 'routine' ? e.routine : f === 'alarm' ? e.alarm : !e.routine && !e.alarm))
    .sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  const cnt = k => (store.events || []).filter(e => e.time && (k === 'routine' ? e.routine : k === 'alarm' ? e.alarm : !e.routine && !e.alarm && e.remind !== '' && e.remind != null)).length;

  /** 일정 고치기 (+ 루틴이면 체크리스트의 그 루틴도: 시각 · 5분 전 알림) */
  const patch = (e, p) => setStore(s => {
    const events = (s.events || []).map(x => (x.id === e.id ? { ...x, ...p } : x));
    const nx = events.find(x => x.id === e.id);
    let checklist = s.checklist;
    if (e.routineId && checklist?.custom?.some(r => r.id === e.routineId)) checklist = { ...checklist, custom: checklist.custom.map(r => (r.id === e.routineId ? { ...r, time: nx.time, alarm: String(nx.remind) === '5' } : r)) };
    return { ...s, events, checklist };
  });
  const remove = e => { if (window.confirm(`"${e.title}" 알람을 지울까요? (캘린더 일정도 함께 지워집니다)`)) setStore(s => ({ ...s, events: (s.events || []).filter(x => x.id !== e.id) })); };
  const add = ev => {
    ev.preventDefault();
    if (!form.title.trim() || !form.time) return;
    const days = form.rep === 'wd' ? 'wd' : form.rep === 'we' ? 'we' : form.rep === 'days' ? [...form.days].sort().join(',') : undefined;
    if (form.rep === 'days' && !form.days.length) return setMsg('요일을 하나 이상 골라 주세요');
    const e = { id: uid(), date: form.rep === 'once' ? form.date : today, time: form.time, end: '', title: form.title.trim(), area: 'P', memo: '알람', alarm: true, remind: form.remind,
      repeat: form.rep === 'once' ? null : { freq: 'D', until: '', skip: [], ...(days ? { days } : {}) } };
    setStore(s => ({ ...s, events: [...(s.events || []), e] }));
    setForm(v => ({ ...v, title: '' }));
    setMsg(`"${e.title}" 알람을 추가했습니다 · ${form.rep === 'once' ? form.date : REP.find(r => r[0] === form.rep)[1]} ${form.time} ${remindLabel(Number(form.remind))}`);
  };

  return (
    <div className="catv am">
      <header className="page-h"><h1>알람 관리</h1><p className="muted">루틴 · 알람 · 일정 · 목표 마감 · 저널링 알림을 한곳에서 보고 고칩니다</p></header>

      <section className="panel">
        <div className="csum-h"><h2>다가오는 알람</h2><span className="muted">7일 안 · {up.length}개{!N.enabled ? ' · "알림 켜기"가 꺼져 있어 루틴 · 알람 · 저널링만 울립니다' : ''}</span></div>
        {groups.length ? groups.map(g => (
          <div key={g.k} className="am-day"><h3>{dayName(g.k)}</h3>
            <ul className="am-up">{g.list.map(a => (
              <li key={`${a.key}-${+a.when}`} className={a.alarm ? 'al' : ''}>
                <b className="am-t">{hm(a.when)}</b><span className={`tag am-k ${a.kind}`}>{KIND[a.kind]}</span>
                <span className="am-n">{a.title}<small className="muted"> · {a.body}</small></span>
              </li>))}</ul></div>))
          : <p className="muted">7일 안에 울릴 알람이 없습니다.</p>}
      </section>

      <section className="panel">
        <div className="csum-h"><h2>알람 추가</h2><span className="muted">루틴과 따로 알람만 · 캘린더에도 들어가고 "알림 켜기"를 꺼 두어도 울립니다</span></div>
        <form className="am-add" onSubmit={add}>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="알람 이름 (예: 약 먹기)" aria-label="알람 이름" />
          <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} aria-label="시각" required />
          <select value={form.rep} onChange={e => setForm({ ...form, rep: e.target.value })} aria-label="반복">{REP.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          {form.rep === 'once' && <input type="date" value={form.date} min={today} onChange={e => setForm({ ...form, date: e.target.value || today })} aria-label="날짜" />}
          {form.rep === 'days' && <span className="am-wd">{[1, 2, 3, 4, 5, 6, 0].map(w => (
            <button type="button" key={w} aria-pressed={form.days.includes(w)} className={form.days.includes(w) ? 'on' : ''} onClick={() => setForm({ ...form, days: form.days.includes(w) ? form.days.filter(x => x !== w) : [...form.days, w] })}>{WEEK[w]}</button>))}</span>}
          <select value={form.remind} onChange={e => setForm({ ...form, remind: e.target.value })} aria-label="알림 시점">{REMINDS.filter(([k]) => k !== 'off').map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          <button className="btn primary" disabled={!form.title.trim()}>+ 알람 추가</button>
        </form>
        {msg && <p className="banner ok" role="status">{msg}<button className="linkish" onClick={() => setMsg('')}>닫기</button></p>}
      </section>

      <section className="panel">
        <div className="csum-h"><h2>알람 목록</h2><span className="muted">시각 · 알림 시점을 바로 고치면 캘린더 · 체크리스트 루틴도 함께 바뀝니다</span>
          <div className="chips grow-r" role="group" aria-label="보기">{[['all', '전체', cnt('routine') + cnt('alarm') + cnt('event')], ['routine', '루틴', cnt('routine')], ['alarm', '알람', cnt('alarm')], ['event', '일정', cnt('event')]].map(([k, n, c]) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{n} {c}</button>)}</div></div>
        {list.length ? <div className="am-list">{list.map(e => {
          const r = remindMinutes(e, N), on = r != null && (N.enabled || ownAlarm(e));
          return (
            <div key={e.id} className={`am-row ${on ? '' : 'off'}`}>
              <label className="am-sw" title={on ? '알람 끄기' : '알람 켜기'}><input type="checkbox" checked={on} onChange={x => patch(e, { remind: x.target.checked ? (e.routine || e.alarm ? '5' : '10') : 'off' })} aria-label={`${e.title} 알람 켜기`} /></label>
              <span className={`tag am-k ${e.routine ? 'routine' : e.alarm ? 'alarm' : 'event'}`}>{e.routine ? '루틴' : e.alarm ? '알람' : '일정'}</span>
              <span className="am-n"><b>{e.title}</b><small className="muted">{e.repeat?.freq ? repeatText(e) : `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8, 10))} 한 번`}</small></span>
              <input type="time" value={e.time} onChange={x => x.target.value && patch(e, { time: x.target.value })} aria-label={`${e.title} 시각`} />
              <select value={e.remind == null || e.remind === '' ? '' : String(e.remind)} onChange={x => patch(e, { remind: x.target.value })} aria-label={`${e.title} 알림 시점`}>
                {(e.remind == null || e.remind === '') && <option value="">기본 ({remindLabel(N.eventMinutes ?? 10)}{N.enabled ? '' : ' · 꺼짐'})</option>}
                {REMINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
              <span className="am-act">{e.alarm ? <button className="tl-del" onClick={() => remove(e)}>삭제</button> : <small className="muted">{e.routine ? '체크리스트에서 삭제' : '캘린더에서 삭제'}</small>}</span>
            </div>);
        })}</div> : <p className="muted">{f === 'all' ? '아직 알람이 없습니다. 위에서 알람을 추가하거나, 루틴 입력에서 "시작 5분 전 알림"을 켜 보세요.' : '여기에 해당하는 알람이 없습니다.'}</p>}
        <p className="note">저널링 알림(매일 일기 · 주간 회고)은 <button className="linkish" onClick={() => openCat('P', '저널링')}>저널링 화면</button>에서 켜고 끕니다.</p>
      </section>

      <Notify />
    </div>
  );
}
