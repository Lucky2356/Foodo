#!/usr/bin/env bash
# Moves the server to the latest Foodo release, if there is a newer one (run by foodo-update.timer).
#   update.sh                 check GitHub for a newer release and install it
#   update.sh --to X.Y.Z      install a given version (also older: a rollback)
#   update.sh --wait-healthy  only wait until the site answers
# Before switching it makes a backup; if the new version does not become healthy, the previous one is
# started again. The database is not restored automatically: see restore.sh.
set -euo pipefail

DIR=${FOODO_DIR:-/opt/foodo}
cd "$DIR"
ENV="$DIR/.env"
get_env() { grep "^$1=" "$ENV" | tail -n1 | cut -d= -f2- || true; }
set_env() {
  local tmp
  tmp=$(mktemp "$DIR/.env.XXXX")
  grep -v "^$1=" "$ENV" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV"
}
compose() { docker compose -f docker-compose.prod.yml "$@"; }
REPO=$(get_env FOODO_REPO); REPO=${REPO:-Lucky2356/Foodo}
DOMAIN=$(get_env FOODO_DOMAIN)

healthy() {
  # Through Caddy, as a visitor reaches it; -k because a new certificate may still be on its way.
  curl -fsk --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health/" | grep -q '"database":"ok"'
}
wait_healthy() {
  for _ in $(seq 1 60); do
    if healthy; then echo "Сайт отвечает: https://$DOMAIN"; return 0; fi
    sleep 5
  done
  echo "Сайт не ответил за 5 минут" >&2
  compose ps >&2 || true
  compose logs --tail 50 api proxy >&2 || true
  return 1
}

case "${1:-}" in
  --wait-healthy) wait_healthy; exit ;;
  --to) target=${2:?version}; ;;
  "") target=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | python3 -Ic 'import json,sys; print(json.load(sys.stdin)["tag_name"].lstrip("v"))') ;;
  *) echo "usage: update.sh [--to X.Y.Z | --wait-healthy]" >&2; exit 2 ;;
esac
[[ "$target" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Неверная версия: $target" >&2; exit 1; }

exec 9>"$DIR/.update.lock"
flock -n 9 || { echo "Обновление уже идёт"; exit 0; }

current=$(get_env FOODO_IMAGE_TAG)
if [ "$target" = "$current" ]; then echo "Уже версия $current"; exit 0; fi
echo "Обновление $current → $target"

# The compose file of the target version, so a release may change it. The Caddyfile belongs to the
# server's setup (install.sh), not to a version.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/docker-compose.prod.yml" "https://github.com/$REPO/releases/download/v$target/docker-compose.prod.yml"

"$DIR/backup.sh"
cp docker-compose.prod.yml "$tmp/previous-compose.yml"
install -m 644 "$tmp/docker-compose.prod.yml" docker-compose.prod.yml
set_env FOODO_IMAGE_TAG "$target"
if compose pull -q && compose up -d --remove-orphans && wait_healthy; then
  echo "Версия $target работает"
  docker image prune -f >/dev/null || true
  exit 0
fi

echo "Версия $target не запустилась — возвращаю $current" >&2
install -m 644 "$tmp/previous-compose.yml" docker-compose.prod.yml
set_env FOODO_IMAGE_TAG "$current"
compose up -d --remove-orphans
wait_healthy || echo "Прежняя версия тоже не отвечает: может понадобиться restore.sh с копией перед обновлением" >&2
exit 1
