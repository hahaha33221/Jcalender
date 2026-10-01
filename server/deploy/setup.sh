#!/usr/bin/env bash
# Jcalender VPS 설치 (Ubuntu 22.04 / 24.04, root 로 실행) — 여러 번 실행해도 안전 (업데이트에도 사용)
#   API_HOST=srv1809055.hstgr.cloud ALLOWED_ORIGINS=https://jcalender.vercel.app bash /opt/jcalender/server/deploy/setup.sh
# 하는 일: PostgreSQL 16 · Node 22 · Caddy(HTTPS 자동) 설치 → DB · 테이블 → API 서버(systemd) → 방화벽 → 매일 백업
set -euo pipefail

APP_DIR=/opt/jcalender
ENV_FILE=/etc/jcalender.env
API_HOST=${API_HOST:-$(grep -s "^API_HOST=" /etc/jcalender.env | cut -d= -f2 || true)}
API_HOST=${API_HOST:-$(hostname -f)}
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-}
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "root 로 실행하세요"; exit 1; }
[ -f "$APP_DIR/server/index.mjs" ] || { echo "$APP_DIR/server 가 없습니다. 먼저 맥북에서 파일을 보내세요 (docs/server-setup.md)"; exit 1; }
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo "Ubuntu/Debian 만 지원합니다 (현재: $PRETTY_NAME)"; exit 1;; esac
echo "운영체제: $PRETTY_NAME · API 주소: https://$API_HOST"

export DEBIAN_FRONTEND=noninteractive
step "1/8 기본 패키지"
apt-get update -q
apt-get install -y -q curl ca-certificates gnupg ufw openssl debian-keyring debian-archive-keyring apt-transport-https >/dev/null

step "2/8 PostgreSQL 16"
if ! command -v psql >/dev/null || ! psql --version | grep -q ' 16\.'; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -q && apt-get install -y -q postgresql-16 >/dev/null
fi
systemctl enable --now postgresql >/dev/null

step "3/8 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -q nodejs >/dev/null
fi
node --version

step "4/8 Caddy (HTTPS 인증서 자동)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy >/dev/null
fi

step "5/8 설정 파일 · 데이터베이스"
id jcal >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin jcal
if [ ! -f "$ENV_FILE" ]; then
  DB_PW=$(openssl rand -hex 24)
  cat > "$ENV_FILE" <<EOF
# Jcalender API 설정 (setup.sh 가 만듦) — 바꾼 뒤: systemctl restart jcal-api
DATABASE_URL=postgres://jcal:${DB_PW}@127.0.0.1:5432/jcal
PORT=8787
HOST=127.0.0.1
ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-https://*.vercel.app,http://localhost:5288}
SESSION_DAYS=90
MAX_BODY_MB=30
API_HOST=${API_HOST}
EOF
  chmod 600 "$ENV_FILE"
  runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='jcal') THEN CREATE ROLE jcal LOGIN; END IF; END\$\$" -c "ALTER ROLE jcal PASSWORD '${DB_PW}'"
else
  [ -n "$ALLOWED_ORIGINS" ] && sed -i "s#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=${ALLOWED_ORIGINS}#" "$ENV_FILE"
  sed -i "s#^API_HOST=.*#API_HOST=${API_HOST}#" "$ENV_FILE"
fi
set -a; . "$ENV_FILE"; set +a
runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='jcal'" | grep -q 1 || runuser -u postgres -- createdb -O jcal jcal
if [ "$(psql "$DATABASE_URL" -tAc "SELECT to_regclass('jcal.users') IS NOT NULL")" != t ]; then
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$APP_DIR/db/schema.sql"
  echo "테이블을 만들었습니다"
fi
for f in "$APP_DIR"/db/migrations/*.sql; do psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c 'SET client_min_messages = warning' -f "$f"; done
echo "테이블 수: $(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='jcal' AND table_type='BASE TABLE'")"

step "6/8 API 서버 (systemd: jcal-api)"
cd "$APP_DIR/server"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R root:root "$APP_DIR"
install -m 644 "$APP_DIR/server/deploy/jcal-api.service" /etc/systemd/system/jcal-api.service
systemctl daemon-reload
systemctl enable jcal-api >/dev/null
systemctl restart jcal-api
sleep 2
curl -fsS http://127.0.0.1:8787/api/health && echo

step "7/8 HTTPS 주소 · 방화벽"
sed "s#__API_HOST__#${API_HOST}#" "$APP_DIR/server/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -8

step "8/8 매일 백업 · 휴지통 정리 (새벽 4시)"
install -m 755 "$APP_DIR/server/deploy/backup.sh" /usr/local/bin/jcal-backup
echo "17 4 * * * root /usr/local/bin/jcal-backup >> /var/log/jcal-backup.log 2>&1" > /etc/cron.d/jcalender
chmod 644 /etc/cron.d/jcalender

printf '\n\033[1m완료\033[0m\n'
echo "API 주소:   https://${API_HOST}  (처음 1분 정도는 인증서 발급 중일 수 있음)"
echo "확인:       curl https://${API_HOST}/api/health"
echo "사용자 추가: cd $APP_DIR/server && node admin.mjs add-user 이메일 이름"
