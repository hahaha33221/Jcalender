import React, { useEffect, useRef, useState } from 'react';
import { CARD_AI_DEFAULT, analyzeCard } from '../cardAi.js';
import { useCtx } from '../shared.jsx';

/* 인맥 관리 › 명함 촬영
   1) 촬영: 카메라로 한 장씩 계속 찍거나 사진 여러 장을 한 번에 고른다 → 대기열
   2) 분석: 대기열에 들어오는 즉시 AI 로 분석 (설정 store.cardAi, src/cardAi.js)
   3) 온보딩: 명함마다 결과 확인 → 관계 → 생일·기념일 → 완료 순서로 묻고 저장, 다음 명함으로
   onSave(person, annivs) 로 연락처와 기념일 관리에 넣는다 */
export const GROUPS = ['가족', '친구', '동료', '지인'];
const uid = () => Math.random().toString(36).slice(2, 10);

/** 사진을 긴 변 1,000px 이하 JPEG 로 줄여 data URL 로 (브라우저 저장 공간 절약) */
export function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = r.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const STATUS = { run: '분석 중…', done: '분석 완료', manual: '직접 입력', fail: '분석 실패 · 직접 입력' };

export default function CardScan({ onSave }) {
  const { store, setStore } = useCtx();
  const cfg = { ...CARD_AI_DEFAULT, ...(store.cardAi || {}) };
  const [queue, setQueue] = useState([]);              // [{ id, img, status, result, err }]
  const [cur, setCur] = useState(null);                // 온보딩 중인 명함 id
  const [showCfg, setShowCfg] = useState(false);
  const [saved, setSaved] = useState(0);
  const [batch, setBatch] = useState(0);             // 이번 등록에서 처리한 장 수 (n / 전체 표시용)
  const camRef = useRef(null), picRef = useRef(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const patch = (id, p) => setQueue(q => q.map(x => (x.id === id ? { ...x, ...p } : x)));
  const run = async item => {
    const c = cfgRef.current;
    if (c.mode === 'off') { patch(item.id, { status: 'manual', result: null }); return; }
    patch(item.id, { status: 'run', err: '' });
    try { patch(item.id, { status: 'done', result: await analyzeCard(item.img, c) }); }
    catch (e) { patch(item.id, { status: 'fail', err: e.message, result: null }); }
  };
  const addFiles = async files => {
    for (const f of [...(files || [])]) {
      try {
        const item = { id: uid(), img: await shrinkImage(f), status: 'run', result: null, err: '' };
        setQueue(q => [...q, item]);
        run(item);                                       // 찍는 동안 뒤에서 분석
      } catch (e) { /* 이미지가 아닌 파일은 건너뜀 */ }
    }
    if (camRef.current) camRef.current.value = '';
    if (picRef.current) picRef.current.value = '';
  };
  const ready = queue.filter(x => x.status !== 'run');
  const item = queue.find(x => x.id === cur);
  const next = () => { const rest = queue.filter(x => x.id !== cur && x.status !== 'run'); setCur(rest[0]?.id || null); };
  const finishOne = (person, annivs) => { onSave(person, annivs); setSaved(n => n + 1); setBatch(n => n + 1); setQueue(q => q.filter(x => x.id !== cur)); next(); };
  const skipOne = () => { setBatch(n => n + 1); setQueue(q => q.filter(x => x.id !== cur)); next(); };
  const setCfg = p => setStore(s => ({ ...s, cardAi: { ...CARD_AI_DEFAULT, ...(s.cardAi || {}), ...p } }));

  return (
    <section className="panel cs">
      <div className="csum-h"><h2>명함 촬영</h2>
        <span className="muted">여러 장을 계속 찍으면 AI 가 뒤에서 분석하고, 한 장씩 확인하며 등록합니다</span>
        <button className="btn sm grow-r" onClick={() => setShowCfg(v => !v)}>{showCfg ? 'AI 설정 닫기' : 'AI 분석 설정'}</button></div>

      <div className="cs-btns">
        <label className="btn primary cs-cam">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
          {queue.length ? '한 장 더 촬영' : '명함 촬영'}
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => addFiles(e.target.files)} />
        </label>
        <label className="btn">사진에서 여러 장 선택<input ref={picRef} type="file" accept="image/*" multiple hidden onChange={e => addFiles(e.target.files)} /></label>
        {ready.length > 0 && <button className="btn primary" onClick={() => { setBatch(0); setCur(ready[0].id); }}>등록 시작 ({ready.length}장)</button>}
        <span className="muted cs-ai">AI 분석: {cfg.mode === 'off' ? '사용 안 함 (직접 입력)' : cfg.mode === 'server' ? '내 서버' : 'Claude API'}</span>
      </div>

      {queue.length > 0 && <ul className="cs-q">{queue.map((x, i) => (
        <li key={x.id} className={x.status}>
          <img src={x.img} alt={`촬영한 명함 ${i + 1}`} />
          <span className="cs-st">{x.status === 'done' && x.result?.name ? x.result.name : STATUS[x.status]}</span>
          {x.status === 'fail' && <small className="cs-err" title={x.err}>{x.err}</small>}
          <span className="cs-qb">
            {x.status === 'fail' && <button className="btn sm" onClick={() => run(x)}>다시 분석</button>}
            <button className="tl-del" onClick={() => setQueue(q => q.filter(k => k.id !== x.id))}>빼기</button>
          </span>
        </li>))}</ul>}
      {saved > 0 && !queue.length && <p className="sh-msg" role="status">명함 {saved}장을 등록했습니다.</p>}

      {showCfg && (
        <div className="cs-cfg">
          <label>분석 방식
            <select value={cfg.mode} onChange={e => setCfg({ mode: e.target.value })}>
              <option value="off">사용 안 함 (직접 입력)</option>
              <option value="server">내 서버 (권장)</option>
              <option value="claude">Claude API 직접 호출</option>
            </select></label>
          {cfg.mode === 'server' && <>
            <label>서버 주소<input value={cfg.endpoint} onChange={e => setCfg({ endpoint: e.target.value.trim() })} placeholder="https://…/business-card" /></label>
            <label>인증 토큰 (선택)<input type="password" value={cfg.token} onChange={e => setCfg({ token: e.target.value.trim() })} placeholder="Bearer 토큰" autoComplete="off" /></label>
          </>}
          {cfg.mode === 'claude' && <>
            <label>API 키<input type="password" value={cfg.apiKey} onChange={e => setCfg({ apiKey: e.target.value.trim() })} placeholder="sk-ant-…" autoComplete="off" /></label>
            <label>모델<input value={cfg.model} onChange={e => setCfg({ model: e.target.value.trim() })} /></label>
            <p className="note">API 키가 이 브라우저에 저장됩니다. 개인 기기에서만 쓰고, 여러 사람이 쓰면 내 서버 방식을 쓰세요.</p>
          </>}
          <p className="note">서버는 POST {'{ image: "data:image/jpeg;base64,…" }'} 를 받아 {'{ name, company, title, phone, email, address }'} 를 돌려주면 됩니다. 자세한 내용: docs/business-card-ai.md</p>
        </div>
      )}

      {item && <Onboarding key={item.id} item={item} index={batch + 1} total={batch + ready.length}
        onDone={finishOne} onSkip={skipOne} onClose={() => setCur(null)} />}
    </section>
  );
}

const STEPS = ['결과 확인', '관계', '생일·기념일', '완료'];

/* 명함 한 장 등록 온보딩 */
function Onboarding({ item, index, total, onDone, onSkip, onClose }) {
  const r = item.result || {};
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: r.name || '', company: r.company || '', title: r.title || '', phone: r.phone || '', email: r.email || '', address: r.address || '' });
  const [group, setGroup] = useState('');
  const [hasDay, setHasDay] = useState(null);
  const [d, setD] = useState({ birthday: '', annivName: '', annivDate: '', toAnniv: true });
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const canNext = [f.name.trim(), group, hasDay === false || (hasDay && (d.birthday || d.annivDate)), true][step];
  const save = () => {
    const person = { id: uid(), name: f.name.trim(), group, phone: f.phone.trim(), company: f.company.trim(), title: f.title.trim(), email: f.email.trim(), address: f.address.trim(),
      birthday: hasDay ? d.birthday : '', annivName: hasDay && d.annivDate ? (d.annivName.trim() || '기념일') : '', annivDate: hasDay ? d.annivDate : '', card: item.img, notes: [] };
    const annivs = !hasDay || !d.toAnniv ? [] : [
      person.birthday && { id: uid(), name: `${person.name} 생일`, person: person.name, date: person.birthday, kind: '생일', yearly: true },
      person.annivDate && { id: uid(), name: `${person.name} ${person.annivName}`, person: person.name, date: person.annivDate, kind: '기념일', yearly: true },
    ].filter(Boolean);
    onDone(person, annivs);
  };
  const msg = item.status === 'done' ? 'AI 가 읽은 결과입니다. 틀린 부분을 고쳐 주세요.' : item.status === 'fail' ? `AI 분석에 실패했습니다 (${item.err}). 직접 입력해 주세요.` : 'AI 분석을 쓰지 않아 직접 입력합니다.';
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal ob" role="dialog" aria-label="명함 등록" onClick={e => e.stopPropagation()}>
        <div className="ob-h"><b>명함 등록</b><span className="muted">{index} / {total}장</span><button className="btn sm" onClick={onClose}>나중에</button></div>
        <ol className="ob-steps">{STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'ok' : ''}><span>{i + 1}</span>{s}</li>)}</ol>
        <img className="ob-img" src={item.img} alt="명함 사진" />

        {step === 0 && <>
          <p className={`ob-msg ${item.status === 'fail' ? 'err' : ''}`}>{msg}</p>
          <div className="rv-fields">
            <label>이름 *<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></label>
            <label>휴대폰<input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} inputMode="tel" /></label>
            <label>회사<input value={f.company} onChange={e => setF({ ...f, company: e.target.value })} /></label>
            <label>직함<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
            <label>이메일<input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} inputMode="email" /></label>
            <label>주소<input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></label>
          </div>
        </>}

        {step === 1 && <>
          <p className="ob-q">{f.name}님과 어떤 관계인가요?</p>
          <div className="ob-pick">{GROUPS.map(g => <button key={g} aria-pressed={group === g} onClick={() => { setGroup(g); setStep(2); }}>{g}</button>)}</div>
        </>}

        {step === 2 && <>
          <p className="ob-q">{f.name}님의 생일이나 기념일이 있나요?</p>
          <div className="ob-pick">
            <button aria-pressed={hasDay === true} onClick={() => setHasDay(true)}>있어요</button>
            <button aria-pressed={hasDay === false} onClick={() => { setHasDay(false); setStep(3); }}>없어요 / 나중에</button>
          </div>
          {hasDay && <div className="rv-fields">
            <label>생일<input type="date" value={d.birthday} onChange={e => setD({ ...d, birthday: e.target.value })} /></label>
            <span />
            <label>기념일 이름<input value={d.annivName} onChange={e => setD({ ...d, annivName: e.target.value })} placeholder="예: 첫 거래일" /></label>
            <label>기념일 날짜<input type="date" value={d.annivDate} onChange={e => setD({ ...d, annivDate: e.target.value })} /></label>
            <label className="chk ob-chk"><input type="checkbox" checked={d.toAnniv} onChange={e => setD({ ...d, toAnniv: e.target.checked })} />기념일 관리에도 추가</label>
          </div>}
        </>}

        {step === 3 && <>
          <p className="ob-q">이대로 등록할까요?</p>
          <ul className="ob-sum">
            <li><span>이름</span><b>{f.name}</b></li>
            <li><span>관계</span><b>{group}</b></li>
            {(f.company || f.title) && <li><span>회사</span><b>{[f.company, f.title].filter(Boolean).join(' · ')}</b></li>}
            {f.phone && <li><span>휴대폰</span><b>{f.phone}</b></li>}
            {f.email && <li><span>이메일</span><b>{f.email}</b></li>}
            <li><span>생일</span><b>{hasDay && d.birthday ? d.birthday : '없음'}</b></li>
            <li><span>기념일</span><b>{hasDay && d.annivDate ? `${d.annivName || '기념일'} ${d.annivDate}` : '없음'}</b></li>
            {hasDay && d.toAnniv && (d.birthday || d.annivDate) && <li><span /><small className="muted">기념일 관리에도 추가됩니다</small></li>}
          </ul>
        </>}

        <div className="ob-f">
          <button className="btn sm" onClick={onSkip}>이 명함 건너뛰기</button>
          <span className="grow" />
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>이전</button>}
          {step < 3 ? <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>다음</button>
            : <button className="btn primary" onClick={save}>{index < total ? '완료 · 다음 명함' : '완료'}</button>}
        </div>
      </div>
    </div>
  );
}
