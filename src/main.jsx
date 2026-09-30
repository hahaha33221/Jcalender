import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { handleRedirect } from './onedrive.js';

// OneDrive 로그인 팝업으로 돌아온 창이면 부모 창에 결과만 넘기고 닫는다
if (!handleRedirect()) createRoot(document.getElementById('root')).render(<App />);
