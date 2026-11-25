#!/data/data/com.termux/files/usr/bin/bash
# 안드로이드(Termux) 녹음 파일 자동 업로드 스크립트

URL="https://rec-31-97-71-87.sslip.io/api/recordings"   # 서버 주소
TOKEN="서버의_API_TOKEN과_같은_값"
DEVICE="phone01"                             # 기기 구분 이름 (영문/숫자)
SRC="$HOME/storage/shared/Recordings"        # 녹음 폴더 (기종마다 다를 수 있음)
SENT="$HOME/.sent_list"                      # 업로드 완료 목록
LOG="$HOME/upload.log"

touch "$SENT"

# 1분 이상 지난 오디오 파일만 대상 (녹음 중인 파일 제외)
find "$SRC" -type f \( -iname '*.m4a' -o -iname '*.mp3' -o -iname '*.amr' \
  -o -iname '*.wav' -o -iname '*.3gp' -o -iname '*.ogg' -o -iname '*.aac' \) -mmin +1 |
while IFS= read -r f; do
  grep -qxF "$f" "$SENT" && continue

  MTIME=$(stat -c %Y "$f")
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 300 \
    -H "Authorization: Bearer $TOKEN" \
    --form-string "device=$DEVICE" \
    --form-string "recorded_at=$MTIME" \
    -F "file=@\"$f\"" \
    "$URL")

  # 201 = 새로 저장, 200 = 이미 있는 파일 → 둘 다 완료 처리
  if [ "$CODE" = "201" ] || [ "$CODE" = "200" ]; then
    echo "$f" >> "$SENT"
    echo "$(date '+%F %T') OK($CODE)  $f" >> "$LOG"
  else
    echo "$(date '+%F %T') FAIL($CODE) $f" >> "$LOG"
  fi
done
