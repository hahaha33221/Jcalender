# OneDrive 연동 (근로 › 업무 문서)

업무 문서 화면은 OneDrive 폴더 구조를 **읽기 전용**으로 보여 줍니다. 서버 없이 브라우저에서 Microsoft 로그인(OAuth 2.0 인증 코드 + PKCE)을 거쳐 Microsoft Graph API를 부릅니다. 파일을 내려받거나 고치거나 지우지 않고, 파일은 OneDrive 웹에서 엽니다.

## 1. 개요

- 필요한 것: Azure 앱 등록 1개와 그 "애플리케이션(클라이언트) ID"
- 권한: Microsoft Graph 위임 권한 `Files.Read`, `User.Read`, `offline_access`
- 토큰 저장: 브라우저 localStorage의 `jcalender.onedrive.token` 키 (앱 데이터 `lifeboard.react.v1`와 분리)
- 연결 전에는 예시 폴더 구조를 보여 줍니다

## 2. 앱 등록 순서

1. https://portal.azure.com › Microsoft Entra ID › 앱 등록 › 새 등록
2. 이름: 예) Jcalender
3. 지원되는 계정 유형
   - 개인 + 회사 계정 모두: "모든 조직 디렉터리의 계정 및 개인 Microsoft 계정"
   - 회사 계정만: "이 조직 디렉터리의 계정만" (이때 앱의 테넌트 설정은 organizations 또는 회사 테넌트)
4. 리디렉션 URI: 플랫폼 **단일 페이지 애플리케이션(SPA)**, 주소는 앱 설정 화면에 표시되는 값
   - 로컬 실행: `http://localhost:5288/`
   - 다른 주소에 배포하면 그 주소도 추가
5. 등록 후 "API 권한" › 권한 추가 › Microsoft Graph › 위임된 권한 › `Files.Read`, `User.Read`, `offline_access`
6. "개요"의 애플리케이션(클라이언트) ID를 복사

## 3. 앱에서 연결

1. 근로 › 업무 문서 › OneDrive 연결 › 설정
2. 클라이언트 ID 붙여넣기, 테넌트 선택
3. "Microsoft 계정으로 로그인" → 팝업에서 로그인·동의
4. 팝업이 막히면 브라우저 주소창의 팝업 허용을 켠 뒤 다시 누르기

## 4. 화면 기능

- 왼쪽 폴더 트리: 펼칠 때 하위 폴더를 불러옴
- 오른쪽 목록: 경로(브레드크럼), 이름·종류·수정일·크기 정렬, "열기"는 OneDrive 웹
- 최근 파일, 파일 이름 검색, 즐겨찾는 폴더
- 통계: 현재 폴더 항목 수, 파일 용량, 30일 넘게 수정 안 된 파일 수
- 마지막으로 본 폴더를 기억

## 5. 참고

- 회사(Microsoft 365) 계정은 조직 정책에 따라 **관리자 동의**가 필요할 수 있습니다. "관리자 승인 필요" 메시지가 나오면 IT 관리자에게 위 권한으로 동의를 요청하세요.
- SPA의 새로 고침 토큰은 약 24시간 유효합니다. 만료되면 다시 로그인하라는 안내가 나옵니다.
- 사용하는 Graph 호출: `/me/drive/root/children`, `/me/drive/items/{id}/children`, `/me/drive/root/search(q=...)`, `/me/drive/recent`
