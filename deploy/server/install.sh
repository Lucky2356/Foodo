#!/usr/bin/env bash
# First setup and re-configuration of a Foodo server (Ubuntu 22.04 or 24.04), run as root.
#   install.sh SETTINGS_FILE
# The settings file holds the values below (the "Server" workflow writes it from repository secrets):
#   FOODO_DOMAIN       the site's domain, its A record pointing to this server
#   FOODO_TLS          e-mail for the Let's Encrypt account, or "internal" for a test certificate
#   FOODO_ADMIN_EMAIL  (optional) administrator account; its password is set by "Forgot password"
#   SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM  mail for password reset
#   FOODO_IMAGE_TAG    (optional) version to run; by default the latest release
# Re-running keeps the generated secrets and the database; it only rewrites the values above.
set -euo pipefail

SETTINGS=${1:?settings file}
SRC=$(cd "$(dirname "$0")/../.." && pwd)
DIR=${FOODO_DIR:-/opt/foodo}
REPO=${FOODO_REPO:-Lucky2356/Foodo}
# The latest release from the redirect of github.com/<repo>/releases/latest: the same host the files
# come from, and no API rate limit for a server behind a shared address.
latest_release() {
  curl -fsSLI --retry 3 --retry-all-errors -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" |
    sed -n 's#.*/releases/tag/v\{0,1\}##p'
}

# shellcheck source=/dev/null
. "$SETTINGS"
: "${FOODO_DOMAIN:?FOODO_DOMAIN is required}"
: "${FOODO_TLS:?FOODO_TLS is required (e-mail or internal)}"

log() { printf '\n== %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Нужны права root" >&2; exit 1; }

log "Docker"
if ! docker compose version >/dev/null 2>&1; then
  # shellcheck source=/dev/null
  . /etc/os-release
  [ "${ID:-}" = ubuntu ] || { echo "Поддерживается Ubuntu 22.04 или 24.04, у сервера: ${PRETTY_NAME:-?}" >&2; exit 1; }
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -yq docker.io docker-compose-v2 curl openssl
  systemctl enable --now docker
fi
docker compose version

if [ "${FOODO_SKIP_SYSTEM:-0}" != 1 ]; then
  log "Firewall (SSH, HTTP, HTTPS) and automatic security updates"
  DEBIAN_FRONTEND=noninteractive apt-get install -yq ufw unattended-upgrades
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable
  systemctl enable --now unattended-upgrades
fi

log "Files in $DIR"
install -d -m 755 "$DIR" "$DIR/deploy"
install -d -m 700 "$DIR/backups"
install -m 644 "$SRC/docker-compose.prod.yml" "$DIR/docker-compose.prod.yml"
install -m 644 "$SRC/deploy/Caddyfile" "$DIR/deploy/Caddyfile"
for f in update.sh backup.sh restore.sh; do install -m 755 "$SRC/deploy/server/$f" "$DIR/$f"; done

log "Settings ($DIR/.env)"
ENV="$DIR/.env"
umask 077
if [ ! -f "$ENV" ]; then
  secret=$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 60)
  dbpass=$(openssl rand -hex 24)
  cat > "$ENV" <<ENVFILE
FOODO_APP_NAME=Foodo
FOODO_IMAGE_OWNER=$(printf '%s' "${REPO%%/*}" | tr '[:upper:]' '[:lower:]')
FOODO_REPO=$REPO
DJANGO_SECRET_KEY=$secret
DJANGO_DEBUG=0
DJANGO_HSTS_SECONDS=31536000
POSTGRES_DB=foodo
POSTGRES_USER=foodo
POSTGRES_PASSWORD=$dbpass
DATABASE_URL=postgres://foodo:$dbpass@db:5432/foodo
EMAIL_USE_TLS=1
ENVFILE
fi
chmod 600 "$ENV"

set_env() {  # set_env KEY VALUE — replaces or appends one line, keeps the rest of .env
  local key=$1 value=$2 tmp
  tmp=$(mktemp "$DIR/.env.XXXX")
  grep -v "^$key=" "$ENV" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV"
}
get_env() { grep "^$1=" "$ENV" | tail -n1 | cut -d= -f2- || true; }

set_env FOODO_DOMAIN "$FOODO_DOMAIN"
set_env FOODO_SITE_URL "https://$FOODO_DOMAIN"
set_env FOODO_TLS "$FOODO_TLS"
set_env DJANGO_ALLOWED_HOSTS "$FOODO_DOMAIN"
set_env DJANGO_CSRF_TRUSTED_ORIGINS "https://$FOODO_DOMAIN"
if [ -n "${SMTP_HOST:-}" ]; then
  set_env DJANGO_EMAIL_BACKEND django.core.mail.backends.smtp.EmailBackend
  set_env EMAIL_HOST "$SMTP_HOST"
  set_env EMAIL_PORT "${SMTP_PORT:-587}"
  set_env EMAIL_HOST_USER "${SMTP_USER:-}"
  set_env EMAIL_HOST_PASSWORD "${SMTP_PASSWORD:-}"
  set_env DEFAULT_FROM_EMAIL "${SMTP_FROM:-Foodo <${SMTP_USER:-noreply@$FOODO_DOMAIN}>}"
  # Port 465 is SMTP over SSL; 587 and 25 use STARTTLS.
  if [ "${SMTP_PORT:-587}" = 465 ]; then set_env EMAIL_USE_SSL 1; set_env EMAIL_USE_TLS 0; else set_env EMAIL_USE_SSL 0; set_env EMAIL_USE_TLS 1; fi
else
  set_env DJANGO_EMAIL_BACKEND django.core.mail.backends.console.EmailBackend
  echo "ВНИМАНИЕ: почта не настроена — письма восстановления пароля не уходят" >&2
fi

tag=${FOODO_IMAGE_TAG:-$(get_env FOODO_IMAGE_TAG)}
if [ -z "$tag" ]; then
  tag=$(latest_release)
fi
[[ "$tag" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Неверная версия: $tag" >&2; exit 1; }
set_env FOODO_IMAGE_TAG "$tag"
echo "Версия: $tag"

# The compose file published with that release; the bundled copy only if the download fails.
if ! curl -fsSL --retry 3 --retry-all-errors -o "$DIR/docker-compose.prod.yml.new" "https://github.com/$REPO/releases/download/v$tag/docker-compose.prod.yml"; then
  echo "Не скачан docker-compose.prod.yml версии $tag — используется копия из репозитория" >&2
  cp "$SRC/docker-compose.prod.yml" "$DIR/docker-compose.prod.yml.new"
fi
mv "$DIR/docker-compose.prod.yml.new" "$DIR/docker-compose.prod.yml"
chmod 644 "$DIR/docker-compose.prod.yml"

log "Containers"
cd "$DIR"
compose() { docker compose -f docker-compose.prod.yml "$@"; }
compose pull -q
compose up -d --remove-orphans

log "Health check"
"$DIR/update.sh" --wait-healthy

if [ -n "${FOODO_ADMIN_EMAIL:-}" ]; then
  log "Administrator account"
  # Created without a password: its owner sets one with "Forgot password", so it never passes through logs.
  compose exec -T -e FOODO_ADMIN_EMAIL="$FOODO_ADMIN_EMAIL" api python manage.py shell -c '
import os
from django.contrib.auth import get_user_model
email = os.environ["FOODO_ADMIN_EMAIL"].strip().lower()
user, created = get_user_model().objects.get_or_create(username=email, defaults={"email": email})
user.is_staff = user.is_superuser = True
if created:
    user.set_unusable_password()
user.save()
print("создан" if created else "уже есть", email)
'
fi

if [ "${FOODO_SKIP_TIMERS:-0}" != 1 ]; then
  log "Automatic updates and daily backups"
  install -m 644 "$SRC"/deploy/server/foodo-*.service "$SRC"/deploy/server/foodo-*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now foodo-update.timer foodo-backup.timer
  systemctl list-timers 'foodo-*' --no-pager
fi

log "Готово: https://$FOODO_DOMAIN (версия $tag)"
