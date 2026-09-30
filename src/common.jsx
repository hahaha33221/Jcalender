import React, { useState } from 'react';
import { useCtx } from './shared.jsx';

/* 여러 화면이 함께 쓰는 공통 테이블 입력 조각 (schema.js v2)
   ProjectSelect  공통 프로젝트(store.projects) 고르기
   TagPicker      공통 태그(store.tags) 붙이기 · 새로 만들기
   AttachList     첨부(store.attachments, owner = { type, id }) 링크 · OneDrive 경로 */
const uid = () => Math.random().toString(36).slice(2, 10);
export const TAG_COLORS = ['#2f6f9f', '#1b8a5a', '#b7791f', '#b8433a', '#7a4fb3', '#4a5563'];

export function ProjectSelect({ value, onChange, label = '프로젝트' }) {
  const { store } = useCtx();
  const list = (store.projects || []).filter(p => p.status !== '완료' || p.id === value);
  return (
    <label className="cm-field">{label}
      <select value={value || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">(없음)</option>
        {list.map(p => <option key={p.id} value={p.id}>{p.name}{p.status && p.status !== '진행' ? ` (${p.status})` : ''}</option>)}
      </select></label>
  );
}

export function TagPicker({ value = [], onChange }) {
  const { store, setStore } = useCtx();
  const tags = store.tags || [];
  const [t, setT] = useState('');
  const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  const add = () => {
    const name = t.trim();
    if (!name) return;
    const old = tags.find(x => x.name === name);
    if (old) { if (!value.includes(old.id)) onChange([...value, old.id]); setT(''); return; }
    const id = uid();
    setStore(s => ({ ...s, tags: [...(s.tags || []), { id, name, color: TAG_COLORS[(s.tags || []).length % TAG_COLORS.length] }] }));
    onChange([...value, id]); setT('');
  };
  return (
    <div className="cm-field cm-tags"><span>태그</span>
      <div className="cm-tagrow">
        {tags.map(x => (
          <button type="button" key={x.id} className={`cm-tag ${value.includes(x.id) ? 'on' : ''}`} style={{ '--tc': x.color }} aria-pressed={value.includes(x.id)} onClick={() => toggle(x.id)}>{x.name}</button>))}
        <input value={t} onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="+ 새 태그" aria-label="새 태그" className="cm-tagin" />
      </div>
    </div>
  );
}

/** 태그 이름 칩 (읽기 전용) */
export function TagChips({ ids = [] }) {
  const { store } = useCtx();
  const tags = (store.tags || []).filter(t => ids.includes(t.id));
  return tags.length ? <span className="cm-chips">{tags.map(t => <span key={t.id} className="cm-tag on sm" style={{ '--tc': t.color }}>{t.name}</span>)}</span> : null;
}

export function AttachList({ owner }) {
  const { store, setStore } = useCtx();
  const list = (store.attachments || []).filter(a => a.owner?.type === owner.type && a.owner?.id === owner.id);
  const [f, setF] = useState({ title: '', url: '' });
  const add = () => {
    const url = f.url.trim();
    if (!url) return;
    const kind = /^https?:\/\//i.test(url) ? 'link' : 'onedrive';
    setStore(s => ({ ...s, attachments: [...(s.attachments || []), { id: uid(), owner, kind, title: f.title.trim() || url, url, added: new Date().toISOString().slice(0, 10) }] }));
    setF({ title: '', url: '' });
  };
  const del = id => setStore(s => ({ ...s, attachments: (s.attachments || []).filter(a => a.id !== id) }));
  return (
    <div className="cm-field cm-att"><span>첨부 (링크 · OneDrive 경로)</span>
      {list.length > 0 && <ul>{list.map(a => (
        <li key={a.id}><span className="cm-kind">{a.kind === 'link' ? '링크' : 'OneDrive'}</span>
          {a.kind === 'link' ? <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a> : <span title={a.url}>{a.title}</span>}
          <button type="button" className="tl-del" onClick={() => del(a.id)} aria-label={`${a.title} 첨부 삭제`}>삭제</button></li>))}</ul>}
      <div className="cm-attadd">
        <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="이름 (선택)" aria-label="첨부 이름" />
        <input value={f.url} onChange={e => setF({ ...f, url: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="https://… 또는 OneDrive 경로 (예: 02_프로젝트/프로젝트A/일정표.xlsx)" aria-label="첨부 주소" />
        <button type="button" className="btn sm" onClick={add} disabled={!f.url.trim()}>추가</button>
      </div>
    </div>
  );
}
