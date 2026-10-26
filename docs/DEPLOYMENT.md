# Развёртывание Foodo

Два варианта, оба собираются в GitHub Actions:

1. **GitHub Pages — тестовый сайт** (сейчас). Только гостевой режим: всё работает в браузере, аккаунтов нет.
2. **Собственный сервер — production** (позже). Готовые образы из GHCR + `docker-compose.prod.yml`: PostgreSQL, API (Django + gunicorn), web (nginx + PWA), Caddy (HTTPS).

GitHub Actions не является хостингом Django и PostgreSQL: для аккаунтов нужен сервер.

## 1. GitHub Pages

Один раз: *Settings → Pages → Build and deployment → Source: **GitHub Actions***.

Дальше каждый push в `main` запускает workflow **Pages** (`.github/workflows/pages.yml`): статическая сборка `vite build --mode static` → `https://<owner>.github.io/<repo>/`. Запуск вручную: *Actions → Pages → Run workflow*.

После публикации задание **verify** того же workflow проверяет уже развёрнутый сайт: HTTPS-ответы главной страницы, manifest, service worker, офлайн-страницы и фото, затем Playwright проходит по опубликованному адресу основной гостевой путь (семья → меню → покупки, 360 px, перезагрузка) и проверку офлайн-режима. Ошибка этого задания означает, что сайт собран, но не работает по адресу публикации.

Ограничения: нет серверного хранения и семейного доступа; цены — только опубликованный набор данных `data/prices/` в самой сборке.

Сведения об операторе и адрес для обращений на странице «О сервисе» задаются переменными репозитория (*Settings → Secrets and variables → Actions → Variables*): `FOODO_OPERATOR` (например, «ИП Иванов Иван Иванович, ИНН 000000000000») и `FOODO_CONTACT_EMAIL`. Их читают workflow Pages и Release (статическая сборка и образ `foodo-web`). Пока переменные не заданы, страница не показывает ни оператора, ни контактов — без заготовок в квадратных скобках. Текст об обработке данных перед публичным запуском стоит проверить с юристом.

## 2. Сервер

### Что нужно

- Linux-сервер (2 vCPU, 2 ГБ RAM, 20 ГБ диска достаточно для старта) с Docker Engine и плагином Compose.
- Домен с A/AAAA-записью на сервер; открытые порты 80 и 443. PostgreSQL наружу **не** публикуется.
- SMTP-ящик для писем восстановления пароля. Без SMTP восстановление в production не работает (письма уходят только в лог при консольном бэкенде).

### Первый запуск

```sh
mkdir -p /opt/foodo && cd /opt/foodo
# из релиза — docker-compose.prod.yml; из исходников того же тега — пример .env и Caddyfile
curl -LO https://github.com/Lucky2356/Foodo/releases/download/v0.1.0/docker-compose.prod.yml
curl -L  https://raw.githubusercontent.com/Lucky2356/Foodo/v0.1.0/.env.example -o .env
mkdir -p deploy && curl -L https://raw.githubusercontent.com/Lucky2356/Foodo/v0.1.0/deploy/Caddyfile -o deploy/Caddyfile
nano .env          # домен, секреты, пароль БД, SMTP
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec api python manage.py createsuperuser
```

При старте API выполняет `migrate` и идемпотентную загрузку стартовых данных (`FOODO_MIGRATE=1`, `FOODO_LOAD_SEED=1`). Повторная загрузка не создаёт дублей и записывает только строки, изменившиеся в `shared/data` с прошлой загрузки (таблица `SeedState`): исправления администратора в остальных записях сохраняются при перезапусках. Если новая версия меняет ту же запись, применяется версия из релиза — постоянные исправления данных лучше вносить в `shared/data` через PR. `python manage.py load_seed --force` применяет все строки заново.

Перед развёртыванием можно проверить подпись образов:

```sh
gh attestation verify oci://ghcr.io/lucky2356/foodo-api:0.1.0 -R Lucky2356/Foodo
gh attestation verify oci://ghcr.io/lucky2356/foodo-web:0.1.0 -R Lucky2356/Foodo
```

### Переменные окружения (`.env`)

| Переменная | Назначение |
| --- | --- |
| `FOODO_DOMAIN`, `FOODO_SITE_URL` | домен (Caddy получает сертификат) и полный адрес для ссылок в письмах |
| `FOODO_IMAGE_OWNER`, `FOODO_IMAGE_TAG` | владелец образов в GHCR (в нижнем регистре) и версия |
| `DJANGO_SECRET_KEY` | длинный случайный ключ; `python3 -c "import secrets; print(secrets.token_urlsafe(50))"` |
| `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS` | домен; `https://домен` |
| `DJANGO_HSTS_SECONDS` | HSTS (после проверки HTTPS) |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL` | БД (пароль в обоих местах одинаковый) |
| `DJANGO_EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL` | SMTP |
| `FOODO_THROTTLE_*` | (необязательно) лимиты частоты: вход, регистрация, сброс, генерация, импорт, цены |

Секреты хранятся только в `.env` на сервере (права `600`) и не попадают в Git.

### Проверка после развёртывания

```sh
curl -sf https://ДОМЕН/api/health/      # {"status":"ok","database":"ok","version":"0.1.0"}
curl -sI https://ДОМЕН/ | grep -i strict-transport-security
```

Затем вручную: регистрация → семья → меню → покупки → выход/вход; письмо восстановления пароля доходит.

### Обновление

```sh
cd /opt/foodo
./backup.sh                                     # см. ниже — всегда перед обновлением
sed -i 's/^FOODO_IMAGE_TAG=.*/FOODO_IMAGE_TAG=0.2.0/' .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d  # миграции выполняются при старте API
curl -sf https://ДОМЕН/api/health/
```

Откат: вернуть прежний `FOODO_IMAGE_TAG` и `up -d`. Если новая версия применила миграции, несовместимые со старой, — восстановить резервную копию (ниже). Разрушительные миграции выпускаются только с отдельной инструкцией в `CHANGELOG.md`.

**Никогда** не выполняйте `docker compose down -v`: это удаляет тома с базой данных.

### Резервное копирование

`backup.sh`:

```sh
#!/bin/sh
set -eu
cd /opt/foodo
mkdir -p backups
ts=$(date +%Y%m%d-%H%M%S)
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "backups/foodo-$ts.dump"
docker compose -f docker-compose.prod.yml exec -T api tar -C /app -czf - media > "backups/media-$ts.tar.gz"
find backups -type f -mtime +14 -delete
```

Запуск по расписанию: `crontab -e` → `30 3 * * * /opt/foodo/backup.sh`. Копии стоит дополнительно переносить с сервера.

### Восстановление

```sh
docker compose -f docker-compose.prod.yml stop api web
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/foodo-YYYYMMDD-HHMMSS.dump
docker compose -f docker-compose.prod.yml exec -T api tar -C /app -xzf - < backups/media-YYYYMMDD-HHMMSS.tar.gz
docker compose -f docker-compose.prod.yml up -d
```

Проверяйте восстановление на отдельной машине хотя бы раз перед запуском.

### Цены на сервере

Workflow цен публикует наборы данных (`frontend/public/data/prices/`). На сервере их можно импортировать:

```sh
docker compose -f docker-compose.prod.yml exec -T api python manage.py import_prices /app/shared/data/prices/rosstat.json --kind rosstat
```

Подробности — [`PRICES.md`](PRICES.md).

## Локальный полный стек (разработчики)

```sh
docker compose up --build    # http://localhost:8080, письма — в `docker compose logs api`
```
