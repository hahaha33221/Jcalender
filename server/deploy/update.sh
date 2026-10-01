#!/usr/bin/env bash
# 맥북에서 실행: 최신 server · db 파일을 VPS 로 보내고 설치 스크립트를 실행한다 (처음 설치 · 업데이트 모두)
#   cd ~/Jcalender && bash server/deploy/update.sh
#   다른 VPS · 주소:  VPS=root@1.2.3.4 API_HOST=1-2-3-4.sslip.io bash server/deploy/update.sh
#   Vercel 주소 제한: ALLOWED_ORIGINS=https://jcalender.vercel.app,http://localhost:5288 bash server/deploy/update.sh
set -euo pipefail
VPS=${VPS:-root@31.97.71.87}
API_HOST=${API_HOST:-srv1809055.hstgr.cloud}
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}
cd "$(dirname "$0")/../.."
echo "VPS($VPS) 로 파일을 보냅니다. root 비밀번호를 물으면 입력하세요."
COPYFILE_DISABLE=1 tar czf - --exclude=node_modules server db | ssh "$VPS" "mkdir -p /opt/jcalender && tar xzf - -C /opt/jcalender && API_HOST='$API_HOST' ALLOWED_ORIGINS='$ALLOWED_ORIGINS' bash /opt/jcalender/server/deploy/setup.sh"
