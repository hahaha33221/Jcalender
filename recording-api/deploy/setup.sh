#!/usr/bin/env bash
# 녹음 업로드 서버 VPS 설치 (root) — Jcalender API 와 겹치지 않게 전용으로만 설치
#   REC_HOST=rec-31-97-71-87.sslip.io bash /opt/jcalender/recording-api/deploy/setup.sh
# 여러 번 실행해도 안전 (업데이트에도 같은 명령, 토큰은 처음 한 번만 만든다)
#
# 전용으로 쓰는 것
#   폴더 /opt/jcalender/recording-api · 데이터 /var/lib/jcal-recording · 설정 /etc/jcal-recording.env
#   서비스 jcal-recording (127.0.0.1:8790) · Nginx 설정 파일 1개 (jcal-recording.conf, 이 주소만) · 인증서 1개 (이 주소만)
# 같이 쓰는 것 (Jcalender 설치에서 만든 것, 바꾸지 않음)
#   리눅스 사용자 jcal · 전용 Node /opt/jcalender/node
# 건드리지 않는 것
#   jcal-api 서비스 · jcalender.conf · 다른 Nginx 사이트 · 방화벽 · 도커 · 시스템 Node · pm2
set -euo pipefail

APP_DIR=/opt/jcalender/recording-api
ENV_FILE=/etc/jcal-recording.env
NODE_DIR=/opt/jcalender/node
NODE="$NODE_DIR/bin/node"; NPM="$NODE_DIR/bin/npm"
saved() { grep -s "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
REC_PORT=${REC_PORT:-$(saved PORT)}
REC_PORT=${REC_PORT:-8790}
REC_HOST=${REC_HOST:-$(saved REC_HOST)}
REC_HOST=${REC_HOST:-rec-31-97-71-87.sslip.io}
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m중단: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "root 로 실행하세요"
[ -f "$APP_DIR/server.js" ] || die "$APP_DIR 가 없습니다. 먼저 맥북에서 recording-api/deploy/update.sh 를 실행하세요"
[ -x "$NODE" ] || die "전용 Node($NODE_DIR)가 없습니다. 먼저 Jcalender API 를 설치하세요 (server/deploy/update.sh)"
id jcal >/dev/null 2>&1 || die "jcal 사용자가 없습니다. 먼저 Jcalender API 를 설치하세요"
systemctl is-active --quiet nginx || die "Nginx 가 실행 중이 아닙니다 (이 스크립트는 Nginx 가 있는 VPS 용)"
echo "녹음 서버 주소: https://$REC_HOST · 내부 포트: $REC_PORT"

if ss -ltnH "sport = :$REC_PORT" | grep -q . && ! systemctl is-active --quiet jcal-recording; then
  die "$REC_PORT 번 포트를 다른 프로그램이 쓰고 있습니다 → REC_PORT=다른번호 를 앞에 붙여 다시 실행하세요"
fi

step "1/4 설정 파일 (토큰은 처음 한 번만 만듦)"
TOKEN=$(saved API_TOKEN)
[ -n "$TOKEN" ] || TOKEN=$(openssl rand -hex 24)
( umask 077; cat > "$ENV_FILE" <<ENV
# 녹음 서버 설정 (setup.sh 가 만듦) — 바꾼 뒤: systemctl restart jcal-recording
API_TOKEN=${TOKEN}
PORT=${REC_PORT}
HOST=127.0.0.1
REC_HOST=${REC_HOST}
ENV
)
chmod 600 "$ENV_FILE"

step "2/4 서버 설치 (systemd 서비스 jcal-recording, 127.0.0.1:$REC_PORT)"
cd "$APP_DIR"
PATH="$NODE_DIR/bin:$PATH" "$NPM" ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R root:root "$APP_DIR"
chmod 755 "$APP_DIR/upload.sh" 2>/dev/null || true
sed "s#__NODE__#${NODE}#" "$APP_DIR/deploy/jcal-recording.service" > /etc/systemd/system/jcal-recording.service
systemctl daemon-reload
systemctl enable jcal-recording >/dev/null 2>&1
systemctl restart jcal-recording
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS "http://127.0.0.1:$REC_PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$REC_PORT/api/health" && echo || die "녹음 서버가 응답하지 않습니다: journalctl -u jcal-recording -n 30 결과를 보내 주세요"

step "3/4 HTTPS 주소 ($REC_HOST, Nginx 설정 1개 추가)"
if [ -d /etc/nginx/sites-enabled ] && grep -qs "sites-enabled" /etc/nginx/nginx.conf; then
  CONF=/etc/nginx/sites-available/jcal-recording.conf; LINK=/etc/nginx/sites-enabled/jcal-recording.conf
else
  CONF=/etc/nginx/conf.d/jcal-recording.conf; LINK=
fi
if grep -rls "server_name.*$REC_HOST" /etc/nginx/ | grep -v jcal-recording.conf | grep -q .; then die "다른 Nginx 설정이 이미 $REC_HOST 를 쓰고 있습니다"; fi
apply_nginx() {   # 설정 검사에 실패하면 jcal-recording.conf 를 되돌리고 중단 → 다른 사이트에 영향 없음
  local backup=""; [ -f "$CONF" ] && backup=$(cat "$CONF")
  cat > "$CONF"; [ -n "$LINK" ] && ln -sf "$CONF" "$LINK"
  if ! nginx -t 2>/tmp/jcal-rec-nginx-test; then
    if [ -n "$backup" ]; then printf '%s\n' "$backup" > "$CONF"; else rm -f "$CONF" ${LINK:+"$LINK"}; fi
    cat /tmp/jcal-rec-nginx-test; die "Nginx 설정 검사 실패 — 녹음 서버 설정을 되돌렸습니다 (다른 사이트는 그대로)"
  fi
  systemctl reload nginx
}
CERT=/etc/letsencrypt/live/$REC_HOST/fullchain.pem
install -d /var/www/jcal-acme
if [ ! -f "$CERT" ]; then
  apply_nginx <<NGX
# 녹음 서버 — 인증서 발급용 (recording-api/deploy/setup.sh)
server {
    listen 80;
    server_name ${REC_HOST};
    location ^~ /.well-known/acme-challenge/ { root /var/www/jcal-acme; }
    location / { return 404; }
}
NGX
  command -v certbot >/dev/null || { apt-get update -q && apt-get install -y -q certbot >/dev/null; }
  certbot certonly --webroot -w /var/www/jcal-acme -d "$REC_HOST" --cert-name "$REC_HOST" \
    --non-interactive --agree-tos --register-unsafely-without-email --deploy-hook "systemctl reload nginx" \
    || die "인증서 발급 실패 (위 메시지를 보내 주세요)"
fi
apply_nginx <<NGX
# 녹음 서버 — 이 주소(${REC_HOST})만 담당 (recording-api/deploy/setup.sh 가 만듦)
server {
    listen 80;
    server_name ${REC_HOST};
    location ^~ /.well-known/acme-challenge/ { root /var/www/jcal-acme; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name ${REC_HOST};
    ssl_certificate     /etc/letsencrypt/live/${REC_HOST}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${REC_HOST}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    # 녹음 파일 최대 200MB (서버 제한과 같음), 바로 서버로 흘려보냄
    client_max_body_size 200m;
    proxy_request_buffering off;
    access_log /var/log/nginx/jcal-recording.access.log;
    error_log  /var/log/nginx/jcal-recording.error.log;
    location / {
        proxy_pass http://127.0.0.1:${REC_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
NGX
echo "Nginx: $CONF 추가 · 인증서 $REC_HOST (certbot 이 자동 갱신)"

step "4/4 바깥 주소로 확인"
curl -fsS --max-time 20 "https://$REC_HOST/api/health" && echo || echo "알림: 바깥 주소 확인 실패 (방화벽 443 허용 여부 확인)"

printf '\n\033[1m완료\033[0m\n'
echo "업로드 주소 (MacroDroid): https://${REC_HOST}/api/recordings/raw"
echo "토큰 (Authorization: Bearer 뒤에 넣을 값): ${TOKEN}"
echo "토큰 다시 보기: grep API_TOKEN ${ENV_FILE}"
