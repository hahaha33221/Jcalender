#!/usr/bin/env bash
# Jcalender VPS 설치 (Ubuntu 22.04 / 24.04, root) — 다른 서비스가 있는 VPS 에서 겹치지 않게 "Jcalender 전용"으로만 설치
#   API_HOST=jcal-31-97-71-87.sslip.io ALLOWED_ORIGINS=https://jcalender-amber.vercel.app,http://localhost:5288 \
#     bash /opt/jcalender/server/deploy/setup.sh
# 여러 번 실행해도 안전 (업데이트에도 같은 명령)
#
# 전용으로 쓰는 것 (모두 이름에 jcal)
#   폴더 /opt/jcalender · 리눅스 사용자 jcal · Node /opt/jcalender/node (시스템 Node · pm2 와 별개)
#   DB 계정 · DB jcal (이미 있는 PostgreSQL 16 클러스터 안에 따로) · API 127.0.0.1:8787 (서비스 jcal-api)
#   Nginx 설정 파일 1개 (jcalender.conf, 이 주소만 담당) · 인증서 1개 (이 주소만) · 백업 /var/backups/jcalender · cron /etc/cron.d/jcalender
# 건드리지 않는 것
#   방화벽(ufw) 켜기 · 끄기 · 규칙, 다른 Nginx 사이트 · 기본 서버, 도커 컨테이너, 다른 DB · 클러스터, 시스템 Node, pm2
set -euo pipefail

APP_DIR=/opt/jcalender
ENV_FILE=/etc/jcalender.env
NODE_DIR=$APP_DIR/node
NODE_MAJOR=22
saved() { grep -s "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
API_PORT=${API_PORT:-$(saved PORT)}
API_PORT=${API_PORT:-8787}
API_HOST=${API_HOST:-$(saved API_HOST)}
case "$API_HOST" in ""|srv*.hstgr.cloud) API_HOST=jcal-31-97-71-87.sslip.io;; esac   # 서버 이름은 다른 서비스와 겹칠 수 있어 전용 주소 사용
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-$(saved ALLOWED_ORIGINS)}
case "$ALLOWED_ORIGINS" in ""|*'*'*) ALLOWED_ORIGINS=https://jcalender-amber.vercel.app,http://localhost:5288;; esac
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m중단: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "root 로 실행하세요"
[ -f "$APP_DIR/server/index.mjs" ] || die "$APP_DIR/server 가 없습니다. 먼저 맥북에서 파일을 보내세요 (docs/server-setup.md)"
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) die "Ubuntu/Debian 만 지원합니다 (현재: $PRETTY_NAME)";; esac
echo "운영체제: $PRETTY_NAME · API 주소: https://$API_HOST · 허용 화면: $ALLOWED_ORIGINS"

# API 포트를 다른 프로그램이 쓰고 있으면 중단 (jcal-api 자신은 괜찮음)
if ss -ltnH "sport = :$API_PORT" | grep -q . && ! systemctl is-active --quiet jcal-api; then
  die "$API_PORT 번 포트를 다른 프로그램이 쓰고 있습니다 → API_PORT=다른번호 를 앞에 붙여 다시 실행하세요"
fi

export DEBIAN_FRONTEND=noninteractive
step "1/7 필요한 패키지 (이미 있으면 건너뜀)"
need=()
for p in curl ca-certificates xz-utils openssl; do dpkg -s "$p" >/dev/null 2>&1 || need+=("$p"); done
if [ ${#need[@]} -gt 0 ]; then apt-get update -q && apt-get install -y -q "${need[@]}" >/dev/null; fi
echo "확인 완료"

step "2/7 PostgreSQL 16 (이미 있는 클러스터를 쓰고, 그 안에 jcal DB 만 따로)"
pg_cluster_port() { pg_lsclusters -h 2>/dev/null | awk '$1==16 && $4=="online"{print $3; exit}'; }
PGPORT=$(pg_cluster_port || true)
if [ -z "$PGPORT" ]; then
  if ! dpkg -s postgresql-16 >/dev/null 2>&1; then
    install -d /usr/share/postgresql-common/pgdg
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
    apt-get update -q && apt-get install -y -q postgresql-16 >/dev/null
  fi
  pg_ctlcluster 16 main start 2>/dev/null || true
  PGPORT=$(pg_cluster_port || true)
fi
[ -n "$PGPORT" ] || die "PostgreSQL 16 클러스터를 찾지 못했습니다 (pg_lsclusters 결과를 보내 주세요)"
echo "PostgreSQL 16 클러스터 포트: $PGPORT (도커 안의 DB 와는 별개)"
pg_as_postgres() { runuser -u postgres -- psql -p "$PGPORT" -v ON_ERROR_STOP=1 -q "$@"; }

step "3/7 전용 Node $NODE_MAJOR ($NODE_DIR, 시스템 Node · pm2 는 그대로)"
if [ ! -x "$NODE_DIR/bin/node" ] || [ "$("$NODE_DIR/bin/node" -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  line=$(curl -fsSL "$base/SHASUMS256.txt" | grep -E "node-v[0-9.]+-linux-x64\.tar\.xz$")
  file=$(echo "$line" | awk '{print $2}'); sum=$(echo "$line" | awk '{print $1}')
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/$file" "$base/$file"
  echo "$sum  $tmp/$file" | sha256sum -c --quiet || die "Node 파일 검증 실패"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar xJf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
fi
NODE="$NODE_DIR/bin/node"; NPM="$NODE_DIR/bin/npm"
echo "Jcalender 전용 Node $("$NODE" -v) · 시스템 Node $(command -v node >/dev/null && node -v || echo 없음) (변경 없음)"

step "4/7 설정 파일 · 데이터베이스"
id jcal >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin jcal
DB_PW=$(saved DATABASE_URL | sed -n 's#^postgres://jcal:\([^@]*\)@.*#\1#p')
[ -n "$DB_PW" ] || DB_PW=$(openssl rand -hex 24)
( umask 077; cat > "$ENV_FILE" <<EOF
# Jcalender API 설정 (setup.sh 가 만듦, 다시 실행하면 새로 씀) — 바꾼 뒤: systemctl restart jcal-api
DATABASE_URL=postgres://jcal:${DB_PW}@127.0.0.1:${PGPORT}/jcal
PORT=${API_PORT}
HOST=127.0.0.1
ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
SESSION_DAYS=90
MAX_BODY_MB=30
API_HOST=${API_HOST}
EOF
)
chmod 600 "$ENV_FILE"
pg_as_postgres -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='jcal') THEN CREATE ROLE jcal LOGIN; END IF; END\$\$" -c "ALTER ROLE jcal PASSWORD '${DB_PW}'"
pg_as_postgres -tAc "SELECT 1 FROM pg_database WHERE datname='jcal'" | grep -q 1 || runuser -u postgres -- createdb -p "$PGPORT" -O jcal jcal
set -a; . "$ENV_FILE"; set +a
if [ "$(psql "$DATABASE_URL" -tAc "SELECT to_regclass('jcal.users') IS NOT NULL")" != t ]; then
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$APP_DIR/db/schema.sql"
  echo "테이블을 만들었습니다"
fi
for f in "$APP_DIR"/db/migrations/*.sql; do psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c 'SET client_min_messages = warning' -f "$f"; done
# 회원가입 초대 코드가 없으면 하나 만든다 (jcal-admin signup 으로 보기 · 바꾸기)
if [ "$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM jcal.server_settings WHERE key = 'signup_code'")" = 0 ]; then
  CODE=$(openssl rand -hex 4 | tr a-f A-F | sed 's/^\(....\)/\1-/')
  psql "$DATABASE_URL" -q -c "INSERT INTO jcal.server_settings (key, value) VALUES ('signup_code', '$CODE') ON CONFLICT DO NOTHING"
fi
echo "jcal DB 테이블 수: $(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='jcal' AND table_type='BASE TABLE'")"

step "5/7 API 서버 (systemd 서비스 jcal-api, 127.0.0.1:$API_PORT)"
cd "$APP_DIR/server"
PATH="$NODE_DIR/bin:$PATH" "$NPM" ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R root:root "$APP_DIR"
sed "s#__NODE__#${NODE}#" "$APP_DIR/server/deploy/jcal-api.service" > /etc/systemd/system/jcal-api.service
printf '#!/bin/sh\ncd %s/server && exec %s admin.mjs "$@"\n' "$APP_DIR" "$NODE" > /usr/local/bin/jcal-admin
chmod 755 /usr/local/bin/jcal-admin
systemctl daemon-reload
systemctl enable jcal-api >/dev/null 2>&1
systemctl restart jcal-api
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$API_PORT/api/health" && echo || die "API 서버가 응답하지 않습니다: journalctl -u jcal-api -n 30 결과를 보내 주세요"

step "6/7 HTTPS 주소 ($API_HOST)"
if systemctl is-active --quiet nginx; then
  # 기존 Nginx 에 이 주소 전용 설정 파일 1개만 추가 (다른 사이트 · 기본 서버 · IPv6 설정은 그대로)
  if [ -d /etc/nginx/sites-enabled ] && grep -qs "sites-enabled" /etc/nginx/nginx.conf; then
    CONF=/etc/nginx/sites-available/jcalender.conf; LINK=/etc/nginx/sites-enabled/jcalender.conf
  else
    CONF=/etc/nginx/conf.d/jcalender.conf; LINK=
  fi
  if grep -rls "server_name.*$API_HOST" /etc/nginx/ | grep -v jcalender.conf | grep -q .; then die "다른 Nginx 설정이 이미 $API_HOST 를 쓰고 있습니다"; fi
  apply_nginx() {   # 설정 검사에 실패하면 jcalender.conf 를 되돌리고 중단 → 다른 사이트에 영향 없음
    local backup=""; [ -f "$CONF" ] && backup=$(cat "$CONF")
    cat > "$CONF"; [ -n "$LINK" ] && ln -sf "$CONF" "$LINK"
    if ! nginx -t 2>/tmp/jcal-nginx-test; then
      if [ -n "$backup" ]; then printf '%s\n' "$backup" > "$CONF"; else rm -f "$CONF" ${LINK:+"$LINK"}; fi
      cat /tmp/jcal-nginx-test; die "Nginx 설정 검사 실패 — Jcalender 설정을 되돌렸습니다 (다른 사이트는 그대로)"
    fi
    systemctl reload nginx
  }
  CERT=/etc/letsencrypt/live/$API_HOST/fullchain.pem
  install -d /var/www/jcal-acme
  if [ ! -f "$CERT" ]; then
    apply_nginx <<EOF
# Jcalender API — 인증서 발급용 (setup.sh)
server {
    listen 80;
    server_name ${API_HOST};
    location ^~ /.well-known/acme-challenge/ { root /var/www/jcal-acme; }
    location / { return 404; }
}
EOF
    command -v certbot >/dev/null || { apt-get update -q && apt-get install -y -q certbot >/dev/null; }
    certbot certonly --webroot -w /var/www/jcal-acme -d "$API_HOST" --cert-name "$API_HOST" \
      --non-interactive --agree-tos --register-unsafely-without-email --deploy-hook "systemctl reload nginx" \
      || die "인증서 발급 실패 (위 메시지를 보내 주세요)"
  fi
  apply_nginx <<EOF
# Jcalender API — 이 주소(${API_HOST})만 담당 (setup.sh 가 만듦)
server {
    listen 80;
    server_name ${API_HOST};
    location ^~ /.well-known/acme-challenge/ { root /var/www/jcal-acme; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name ${API_HOST};
    ssl_certificate     /etc/letsencrypt/live/${API_HOST}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${API_HOST}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 32m;
    access_log /var/log/nginx/jcalender.access.log;
    error_log  /var/log/nginx/jcalender.error.log;
    location / {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
  echo "Nginx: $CONF 추가 · 인증서 $API_HOST (certbot 이 자동 갱신)"
elif ss -ltnH 'sport = :443' | grep -q . || ss -ltnH 'sport = :80' | grep -q .; then
  die "80/443 번 포트를 Nginx 가 아닌 프로그램이 쓰고 있습니다 (ss -ltnp 결과를 보내 주세요)"
else
  # 웹 서버가 없는 VPS: Caddy 설치 (HTTPS 자동)
  if ! command -v caddy >/dev/null; then
    apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q && apt-get install -y -q caddy >/dev/null
  fi
  sed -e "s#__API_HOST__#${API_HOST}#" -e "s#__API_PORT__#${API_PORT}#" "$APP_DIR/server/deploy/Caddyfile" > /etc/caddy/Caddyfile
  systemctl enable caddy >/dev/null 2>&1
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
fi
# 방화벽은 켜거나 바꾸지 않는다. 켜져 있는데 443 허용이 없을 때만 알려 준다
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw status | grep -qE '^443(/tcp)?\s+ALLOW' || echo "알림: ufw 에 443 허용이 없습니다 → ufw allow 443/tcp"
fi

step "7/7 매일 백업 · 휴지통 정리 (새벽 4시 17분, jcal DB 만)"
install -m 755 "$APP_DIR/server/deploy/backup.sh" /usr/local/bin/jcal-backup
echo "17 4 * * * root /usr/local/bin/jcal-backup >> /var/log/jcal-backup.log 2>&1" > /etc/cron.d/jcalender
chmod 644 /etc/cron.d/jcalender

printf '\n\033[1m완료\033[0m\n'
echo "API 주소:    https://${API_HOST}"
echo "확인:        curl https://${API_HOST}/api/health"
echo "사용자 추가: jcal-admin add-user 이메일 이름"
/usr/local/bin/jcal-admin signup
