import React from 'react';

/* 화면을 그리다 오류가 나면 빈 화면 대신 오류 내용과 데이터 백업 버튼을 보여 준다
   (저장된 데이터는 건드리지 않는다) */
const KEY = 'lifeboard.react.v1';
export default class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error(err, info); this.info = info?.componentStack || ''; }
  backup = () => {
    let raw = '';
    try { raw = localStorage.getItem(KEY) || ''; } catch { /* 무시 */ }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'jcalender_data_backup.json' });
    document.body.appendChild(a); a.click(); a.remove();
  };
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    return (
      <div className="eb">
        <h1>화면을 여는 중 오류가 났습니다</h1>
        <p>저장된 데이터는 지워지지 않았습니다. 아래 오류 내용을 그대로 복사해 알려 주세요.</p>
        <pre className="eb-msg">{String(e?.message || e)}{'\n'}{(e?.stack || '').split('\n').slice(0, 6).join('\n')}{'\n'}{(this.info || '').split('\n').slice(0, 6).join('\n')}</pre>
        <div className="eb-btns">
          <button className="btn primary" onClick={this.backup}>지금 데이터 백업 받기</button>
          <button className="btn" onClick={() => { location.hash = '#/'; location.reload(); }}>대시보드로 다시 열기</button>
        </div>
      </div>
    );
  }
}
