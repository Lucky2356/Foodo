#!/usr/bin/env bash
# Restores the database (and uploaded files, if the matching archive is there) from a backup.
#   restore.sh backups/foodo-YYYYMMDD-HHMMSS.dump --yes
# Everything written after that backup is lost; a fresh backup of the current state is made first.
set -euo pipefail

DIR=${FOODO_DIR:-/opt/foodo}
cd "$DIR"
dump=${1:?backup file}
[ "${2:-}" = --yes ] || { echo "Восстановление заменит текущие данные. Повторите с --yes." >&2; exit 2; }
[ -s "$dump" ] || { echo "Нет файла $dump" >&2; exit 1; }
compose() { docker compose -f docker-compose.prod.yml "$@"; }

"$DIR/backup.sh"
compose stop api web
# shellcheck disable=SC2016  # expanded inside the database container, where these variables live
compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$dump"
media="${dump/foodo-/media-}"
media="${media%.dump}.tar.gz"
compose up -d
if [ -s "$media" ]; then compose exec -T api tar -C /app -xzf - < "$media"; fi
"$DIR/update.sh" --wait-healthy
echo "Восстановлено из $dump"
