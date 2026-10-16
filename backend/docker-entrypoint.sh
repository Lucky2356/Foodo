#!/bin/sh
# Optional start-up tasks, both idempotent. Enable with FOODO_MIGRATE=1 / FOODO_LOAD_SEED=1.
set -eu
if [ "${FOODO_MIGRATE:-0}" = "1" ]; then
  python manage.py migrate --noinput
fi
if [ "${FOODO_LOAD_SEED:-0}" = "1" ]; then
  python manage.py load_seed
fi
exec "$@"
