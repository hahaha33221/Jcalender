#!/usr/bin/env node
/* 사용자 관리 (VPS 에서 root 로 실행)
   node admin.mjs add-user <이메일> [이름]      새 사용자 (비밀번호는 화면에서 두 번 입력)
   node admin.mjs set-password <이메일>         비밀번호 바꾸기 (그 사용자의 로그인 기기는 모두 로그아웃)
   node admin.mjs list                          사용자 · 동기화 상태 보기
   node admin.mjs logout-all <이메일>           모든 기기 로그아웃
   node admin.mjs rename <이메일> <이름>        표시 이름 바꾸기
   node admin.mjs delete-user <이메일>          사용자와 그 사용자의 모든 데이터 삭제
   node admin.mjs role <이메일> member|suspended   권한 바꾸기 (일반 · 정지). 관리자는 OWNER_EMAILS 계정뿐
   node admin.mjs signup                        회원가입 방식 · 초대 코드 보기
   node admin.mjs signup code                   초대 코드 방식 + 새 초대 코드 만들기 (예전 코드는 못 씀)
   node admin.mjs signup open | closed          누구나 가입 / 가입 막기
   (VPS 에서는 node admin.mjs 대신 jcal-admin) */
import crypto from 'crypto';
import readline from 'readline';
import { pool } from './db.mjs';
import { hashPassword } from './auth.mjs';

function askHidden(q) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); };   // 입력 글자는 화면에 안 보이게
    rl.question(q, a => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}
async function askPassword() {
  const a = await askHidden('비밀번호(8자 이상): ');
  if (a.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다');
  const b = await askHidden('비밀번호 다시: ');
  if (a !== b) throw new Error('두 비밀번호가 다릅니다');
  return hashPassword(a);
}

const [, , cmd, emailRaw, name = ''] = process.argv;
const setSetting = (k, v) => pool.query(`INSERT INTO jcal.server_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, v]);
const newCode = () => Array.from(crypto.randomBytes(8), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('').replace(/^(.{4})/, '$1-');
const email = String(emailRaw || '').trim().toLowerCase();
try {
  if (cmd === 'add-user' && email) {
    const h = await askPassword();
    // import-backup.mjs 로 먼저 만들어진 사용자('!not-set')면 비밀번호만 넣는다
    const r = await pool.query(`INSERT INTO jcal.users (email, name, password_hash) VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = COALESCE(NULLIF(EXCLUDED.name, ''), jcal.users.name)
      WHERE jcal.users.password_hash = '!not-set' RETURNING id`, [email, name, h]);
    console.log(r.rowCount ? `사용자를 만들었습니다: ${email}` : `이미 있는 사용자입니다. 비밀번호를 바꾸려면: node admin.mjs set-password ${email}`);
  } else if (cmd === 'set-password' && email) {
    const h = await askPassword();
    const r = await pool.query('UPDATE jcal.users SET password_hash = $2 WHERE lower(email) = $1 RETURNING id', [email, h]);
    if (!r.rowCount) throw new Error(`없는 사용자입니다: ${email}`);
    await pool.query('DELETE FROM jcal.sessions WHERE user_id = $1', [r.rows[0].id]);
    console.log('비밀번호를 바꾸고 모든 기기를 로그아웃했습니다');
  } else if (cmd === 'logout-all' && email) {
    const r = await pool.query('DELETE FROM jcal.sessions s USING jcal.users u WHERE s.user_id = u.id AND lower(u.email) = $1', [email]);
    console.log(`로그아웃한 기기: ${r.rowCount}`);
  } else if (cmd === 'rename' && email && name) {
    const r = await pool.query('UPDATE jcal.users SET name = $2 WHERE lower(email) = $1', [email, name.slice(0, 100)]);
    console.log(r.rowCount ? `이름을 바꿨습니다: ${email} → ${name}` : `없는 사용자입니다: ${email}`);
  } else if (cmd === 'delete-user' && email) {
    const r = await pool.query('DELETE FROM jcal.users WHERE lower(email) = $1', [email]);
    console.log(r.rowCount ? `삭제했습니다: ${email} (데이터 포함)` : `없는 사용자입니다: ${email}`);
  } else if (cmd === 'role' && email && ['member', 'suspended'].includes(name)) {
    const r = await pool.query('UPDATE jcal.users SET role = $2, role_updated_at = now() WHERE lower(email) = $1 RETURNING id', [email, name]);
    if (!r.rowCount) throw new Error(`없는 사용자입니다: ${email}`);
    if (name === 'suspended') await pool.query('DELETE FROM jcal.sessions WHERE user_id = $1', [r.rows[0].id]);
    console.log(`권한을 바꿨습니다: ${email} → ${{ member: '일반', suspended: '정지' }[name]}`);
  } else if (cmd === 'signup') {
    const arg = emailRaw;                                         // code | open | closed | (없음)
    if (arg === 'code') { await setSetting('signup_code', newCode()); await setSetting('signup_mode', 'code'); }
    else if (arg === 'open' || arg === 'closed') await setSetting('signup_mode', arg);
    else if (arg) throw new Error('signup 뒤에는 code · open · closed 중 하나');
    const { rows } = await pool.query("SELECT key, value FROM jcal.server_settings WHERE key IN ('signup_mode', 'signup_code')");
    const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const label = { code: '초대 코드가 있어야 가입', open: '누구나 가입', closed: '가입 막힘 (관리자가 add-user 로만 추가)' };
    console.log(`회원가입 방식: ${label[m.signup_mode] || label.closed}`);
    if (m.signup_mode === 'code') console.log(m.signup_code ? `초대 코드: ${m.signup_code}  (가입할 사람에게 알려 주세요. 바꾸려면: signup code)` : '초대 코드가 아직 없습니다 → signup code 로 만드세요');
  } else if (cmd === 'list') {
    const { rows } = await pool.query(`SELECT u.email, u.name, u.role, u.last_login_at, s.version, s.updated_at, s.device, s.size_bytes,
      (SELECT count(*) FROM jcal.sessions x WHERE x.user_id = u.id AND x.expires_at > now()) AS sessions
      FROM jcal.users u LEFT JOIN jcal.store_snapshots s ON s.user_id = u.id ORDER BY u.created_at`);
    console.table(rows.map(r => ({ 이메일: r.email, 이름: r.name, 권한: r.role, 로그인기기: Number(r.sessions), 동기화버전: r.version ?? '-', 마지막동기화: r.updated_at?.toISOString() ?? '-', 기기: r.device || '-', 크기KB: r.size_bytes ? Math.round(r.size_bytes / 1024) : '-' })));
  } else {
    console.log('사용법: add-user <이메일> [이름] | set-password <이메일> | rename <이메일> <이름> | logout-all <이메일> | delete-user <이메일> | role <이메일> member|suspended | signup [code|open|closed] | list');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`오류: ${e.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
