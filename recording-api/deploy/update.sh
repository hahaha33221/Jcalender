#!/usr/bin/env bash
# 맥북에서 실행: recording-api 파일을 VPS 로 보내고 설치 스크립트를 실행한다 (처음 설치 · 업데이트 모두)
#   cd ~/Jcalender && bash recording-api/deploy/update.sh
#   다른 VPS · 주소:  VPS=root@1.2.3.4 REC_HOST=rec-1-2-3-4.sslip.io bash recording-api/deploy/update.sh
# 먼저 Jcalender API 가 설치되어 있어야 한다 (server/deploy/update.sh, 전용 Node 를 같이 씀)
set -euo pipefail
VPS=${VPS:-root@31.97.71.87}
REC_HOST=${REC_HOST:-rec-31-97-71-87.sslip.io}
cd "$(dirname "$0")/../.."
echo "VPS($VPS) 로 녹음 서버 파일을 보냅니다. root 비밀번호를 물으면 입력하세요."
COPYFILE_DISABLE=1 tar czf - --exclude=node_modules --exclude=data recording-api | ssh "$VPS" "mkdir -p /opt/jcalender && tar xzf - -C /opt/jcalender && REC_HOST='$REC_HOST' bash /opt/jcalender/recording-api/deploy/setup.sh"
