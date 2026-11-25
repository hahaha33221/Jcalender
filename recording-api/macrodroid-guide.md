# MacroDroid 설정 안내

새 녹음 파일이 생기면 서버의 `/api/recordings/raw`로 바로 업로드하는 매크로입니다.
MacroDroid의 HTTP 요청은 파일을 본문에 그대로 담아 보내므로 multipart 주소(`/api/recordings`)가 아니라 **raw 주소**를 사용합니다.

## 0. 사전 준비

1. Play 스토어에서 MacroDroid 설치
2. 권한 허용
   - 설정 → 애플리케이션 → MacroDroid → 권한 → 파일 및 미디어 → **모든 파일 관리 허용**
   - 설정 → 애플리케이션 → MacroDroid → 배터리 → **제한 없음**
3. 녹음 폴더 확인: 내 파일 앱에서 녹음 파일이 저장되는 실제 위치 확인
   - 삼성 통화녹음: `내장 저장공간/Recordings/Call`
   - 삼성 음성녹음: `내장 저장공간/Recordings/Voice Recorder`

## 1. 트리거

매크로 추가 → 트리거 `+` → **파일 변경(File Change)**

| 항목 | 값 |
|---|---|
| 폴더 | `Recordings/Call` (통화녹음) 또는 `Recordings` |
| 감지할 이벤트 | 생성됨(Created) |
| 파일 이름 패턴 | `*` (또는 `*.m4a`) |

통화녹음과 음성녹음을 모두 보내려면 트리거를 폴더별로 2개 추가합니다.

## 2. 동작

### 2-1. 대기
동작 `+` → **대기(Wait Before Next Action)** → **15초**
녹음 파일 쓰기가 끝날 때까지 기다리는 용도입니다.

### 2-2. 반복 (실패 시 최대 3회 재시도)
동작 `+` → **반복(Repeat Actions)** → 횟수 **3회**

반복 안에 아래 동작을 넣습니다.

**① HTTP 요청 (HTTP Request)**

설정 탭

| 항목 | 값 |
|---|---|
| 요청 방식 | POST |
| URL | `https://내사이트.com/api/recordings/raw` (Jcalender VPS: `https://jcal-31-97-71-87.sslip.io/rec/api/recordings/raw`) |
| 시간 제한 | 300초 |
| HTTP 응답 코드 저장 | 정수 변수 `upload_code` 새로 생성 (로컬) |
| 다음 동작 차단 | 켜기 (Block next action until complete) |

쿼리 매개변수(Query Params) 탭

| 키 | 값 |
|---|---|
| device | `phone01` |
| filename | 매직 텍스트(`…` 버튼) → 트리거의 **파일 이름** |

헤더 매개변수(Header Params) 탭

| 키 | 값 |
|---|---|
| Authorization | `Bearer 서버의_API_TOKEN` |

콘텐츠 본문(Content Body) 탭

| 항목 | 값 |
|---|---|
| 콘텐츠 유형 | `application/octet-stream` |
| 콘텐츠 원본 | 파일 → 트리거된 파일 (경로에 매직 텍스트 **파일 경로/이름** 사용) |

**② 조건(If): `upload_code` = 201 또는 `upload_code` = 200**
- 그렇다면 → **반복 중단(Break From Loop)**
- 아니면 → **대기 60초**

### 2-3. (선택) 결과 알림
반복 뒤에 **알림 표시**: `업로드 결과 {v=upload_code} : {파일 이름 매직 텍스트}`
처음 테스트할 때 켜 두고, 잘 되면 지우세요.

## 3. 제약 조건 (선택)

- **Wi-Fi 연결됨**: 모바일 데이터 사용을 막고 싶을 때
  (단, 이 경우 Wi-Fi가 없을 때 생긴 파일은 업로드되지 않습니다)

## 4. 콘텐츠 원본에 매직 텍스트를 넣을 수 없는 경우

MacroDroid 버전에 따라 콘텐츠 본문의 파일을 고정 파일로만 고를 수 있습니다. 이 경우:

1. HTTP 요청 앞에 **파일 작업(File Operation) → 복사** 추가
   - 원본: 트리거된 파일
   - 대상: `내장 저장공간/MacroDroid/upload/` 에 `current.m4a` 이름으로 덮어쓰기
2. HTTP 요청의 콘텐츠 원본을 `MacroDroid/upload/current.m4a` 고정 파일로 지정
3. 쿼리 매개변수 `filename`에는 그대로 **원래 파일 이름** 매직 텍스트를 넣음

서버는 `filename` 값으로 이름을 저장하므로 원래 이름이 유지됩니다.

## 5. 응답 코드 의미

| 코드 | 의미 | 처리 |
|---|---|---|
| 201 | 새로 저장됨 | 완료 |
| 200 | 이미 있는 파일 | 완료 |
| 400 | filename 누락 / 빈 파일 | 설정 확인 |
| 401 | 토큰 오류 | Authorization 값 확인 (`Bearer ` 띄어쓰기 포함) |
| 413 | 200MB 초과 | 서버 제한 확인 |
| 415 | 오디오가 아닌 확장자 | 트리거 파일 패턴 확인 |
| 0 또는 -1 | 서버 연결 실패 | 네트워크, URL, HTTPS 확인 |

## 6. 테스트 순서

1. 서버 실행 후 PC에서 `curl https://내사이트.com/api/health` → `{"ok":true}` 확인
2. 매크로 저장 → 짧게 음성녹음 1개 저장
3. 알림으로 `201`이 뜨는지 확인
4. 서버 목록 확인
   ```bash
   curl -H "Authorization: Bearer 토큰" https://내사이트.com/api/recordings
   ```

## 7. 한계와 보완

- 파일이 생긴 순간에만 동작하므로, 휴대폰이 꺼져 있었거나 3회 모두 실패한 파일은 자동으로 다시 보내지 않습니다.
- 누락이 걱정되면 Termux 스크립트(`upload.sh`)를 하루 1회 보조로 돌리세요. 서버가 중복을 걸러내므로 같이 써도 문제없습니다.
- 녹음을 시작할 때 파일이 바로 생기는 기종은 15초 대기로는 녹음이 끝나지 않습니다. 이 경우 통화녹음은 트리거를 **통화 종료**로 바꾸는 방식이 필요합니다. 알려주시면 설정을 바꿔 드립니다.
