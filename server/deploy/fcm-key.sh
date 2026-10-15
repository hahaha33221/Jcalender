#!/usr/bin/env bash
# 맥북에서 실행: Firebase 서비스 계정 키(JSON)를 VPS 에 넣는다 → 안드로이드 앱 서버 푸시가 켜짐
#   cd ~/Jcalender && bash server/deploy/fcm-key.sh ~/Downloads/<서비스계정 키>.json
#   (키 파일은 저장소에 넣지 마세요. 넣은 뒤에는 맥북에서 지워도 됩니다)
set -euo pipefail
VPS=${VPS:-root@31.97.71.87}
F=${1:-}
[ -n "$F" ] || { echo "사용법: bash server/deploy/fcm-key.sh <서비스 계정 키 JSON 파일>"; exit 1; }
[ -f "$F" ] || { echo "파일이 없습니다: $F"; exit 1; }
grep -q '"service_account"' "$F" || { echo "Firebase 서비스 계정 키 파일이 아닙니다 (google-services.json 은 GitHub 에 넣는 파일입니다)"; exit 1; }
echo "VPS($VPS) 로 키를 보냅니다. root 비밀번호를 물으면 입력하세요."
ssh "$VPS" 'jcal-admin fcm-key -' < "$F"
