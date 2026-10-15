/* cap add android 다음에 실행: 권한 · 아이콘 · 서명 · 버전 (android/ 폴더는 저장소에 두지 않고 빌드 때마다 새로 만든다)
   - 권한: 마이크(아이디어 뱅크 녹음) · 진동 (알림 · 정확한 알람 권한은 local-notifications 플러그인이 넣음)
   - 아이콘: res-override/ 를 덮어씀 (앱 아이콘 · 알림 줄 작은 아이콘 ic_stat_jcal)
   - 서명: JCAL_KEYSTORE (빌드에서 만든 키, 저장소에는 없음) — 같은 키로 서명해야 새 버전을 지우지 않고 덮어 설치할 수 있음
   - 버전: JCAL_VERSION_CODE (GitHub Actions 실행 번호, 늘 커짐)
   - 서버 푸시(FCM): android/app/google-services.json 이 있으면(GitHub 비밀 GOOGLE_SERVICES_JSON) 앱 이름표(User-Agent)에 JcalFCM 을 붙여
     화면(src/native.js)이 "이 앱은 서버 푸시를 받을 수 있다"는 것을 알게 한다. 없으면 서버 푸시 없이(휴대폰 예약 알람만) 빌드 */
import fs from 'fs';
import path from 'path';

const A = 'android/app';
const must = (s, a, what) => { if (!s.includes(a)) throw new Error(`patch 실패: ${what} 를 찾지 못함`); return s; };

// 1) 권한
const mf = `${A}/src/main/AndroidManifest.xml`;
let m = must(fs.readFileSync(mf, 'utf8'), '<uses-permission android:name="android.permission.INTERNET" />', 'INTERNET 권한');
const perms = ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'VIBRATE'].filter(p => !m.includes(`android.permission.${p}"`));
m = m.replace('<uses-permission android:name="android.permission.INTERNET" />', ['<uses-permission android:name="android.permission.INTERNET" />', ...perms.map(p => `    <uses-permission android:name="android.permission.${p}" />`)].join('\n'));
fs.writeFileSync(mf, m);

// 2) 아이콘 (적응형 아이콘 xml 은 빼고 PNG 를 씀)
fs.rmSync(`${A}/src/main/res/mipmap-anydpi-v26`, { recursive: true, force: true });
const copy = (src, dst) => { for (const f of fs.readdirSync(src)) { const s = path.join(src, f), d = path.join(dst, f); if (fs.statSync(s).isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, d); } else fs.copyFileSync(s, d); } };
copy('res-override', `${A}/src/main/res`);

// 3) 서명 · 4) 버전
const bg = `${A}/build.gradle`;
let g = must(fs.readFileSync(bg, 'utf8'), 'versionCode 1', 'versionCode');
g = g.replace('versionCode 1', "versionCode Integer.parseInt(System.getenv('JCAL_VERSION_CODE') ?: '1')")
  .replace('versionName "1.0"', "versionName \"1.0.\" + (System.getenv('JCAL_VERSION_CODE') ?: '1')");
g = must(g, '    buildTypes {', 'buildTypes').replace('    buildTypes {', `    signingConfigs {
        jcal {
            storeFile file(System.getenv('JCAL_KEYSTORE') ?: 'missing.keystore')
            storePassword System.getenv('JCAL_KEYSTORE_PASSWORD') ?: ''
            keyAlias 'jcal'
            keyPassword System.getenv('JCAL_KEYSTORE_PASSWORD') ?: ''
        }
    }
    buildTypes {
        debug {
            if (System.getenv('JCAL_KEYSTORE')) signingConfig signingConfigs.jcal
        }`);
fs.writeFileSync(bg, g);
// 5) 서버 푸시 (google-services.json 이 있을 때만 — 없으면 Firebase 를 부르지 않게)
const fcm = fs.existsSync(`${A}/google-services.json`);
if (fcm) {
  const cf = 'capacitor.config.json', c = JSON.parse(fs.readFileSync(cf, 'utf8'));
  c.android = { ...(c.android || {}), appendUserAgent: 'JcalFCM' };
  fs.writeFileSync(cf, `${JSON.stringify(c, null, 2)}\n`);
}
console.log('서버 푸시(FCM):', fcm ? '켬' : '끔 (google-services.json 없음)');
console.log('android 패치 완료: 권한', perms.join(', ') || '(이미 있음)', '· 아이콘 · 서명 · 버전');
