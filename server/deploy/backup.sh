#!/usr/bin/env bash
# 매일 DB 백업 (14일 보관) + 30일 지난 휴지통 정리 — /etc/cron.d/jcalender 에서 실행
set -euo pipefail
set -a; . /etc/jcalender.env; set +a
DIR=/var/backups/jcalender
install -d -m 700 "$DIR"
F="$DIR/jcal_$(date +%Y%m%d_%H%M).sql.gz"
pg_dump "$DATABASE_URL" --no-owner | gzip > "$F"
chmod 600 "$F"
find "$DIR" -name 'jcal_*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') 백업 $(du -h "$F" | cut -f1) · 휴지통 정리 $(psql "$DATABASE_URL" -tAc 'SELECT jcal.purge_trash()')건"
