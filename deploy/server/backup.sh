#!/usr/bin/env bash
# Database and uploaded files to /opt/foodo/backups (run daily by foodo-backup.timer and before
# every update). Copies older than FOODO_BACKUP_DAYS days (14) are removed.
set -euo pipefail

DIR=${FOODO_DIR:-/opt/foodo}
cd "$DIR"
compose() { docker compose -f docker-compose.prod.yml "$@"; }
umask 077
install -d -m 700 backups
ts=$(date +%Y%m%d-%H%M%S)
# Written under a temporary name first, so an interrupted dump never looks like a finished backup.
# shellcheck disable=SC2016  # expanded inside the database container, where these variables live
compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/.foodo-$ts.dump"
[ -s "backups/.foodo-$ts.dump" ] || { echo "Пустая копия базы" >&2; rm -f "backups/.foodo-$ts.dump"; exit 1; }
mv "backups/.foodo-$ts.dump" "backups/foodo-$ts.dump"
compose exec -T api tar -C /app -czf - media > "backups/media-$ts.tar.gz"
find backups -maxdepth 1 -type f -name 'foodo-*.dump' -mtime +"${FOODO_BACKUP_DAYS:-14}" -delete
find backups -maxdepth 1 -type f -name 'media-*.tar.gz' -mtime +"${FOODO_BACKUP_DAYS:-14}" -delete
echo "Копия: backups/foodo-$ts.dump ($(du -h "backups/foodo-$ts.dump" | cut -f1))"
