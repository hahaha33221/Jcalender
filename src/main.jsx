import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import './styles.css';
import { handleRedirect } from './onedrive.js';
import { registerSW } from './push.js';

// OneDrive 로그인 팝업으로 돌아온 창이면 부모 창에 결과만 넘기고 닫는다
registerSW();                                                   // 웹 푸시 받기용 서비스 워커 (public/sw.js)
if (!handleRedirect()) createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
