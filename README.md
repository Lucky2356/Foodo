# Foodo

**Foodo** («Фудо») — бесплатный сервис планирования питания для человека и семьи: меню на 1–35 дней, порции и КБЖУ для каждого, рецепты, учёт того, что есть дома, список покупок с ценами вашего города и экспорт в PDF/XLSX. Сайт и устанавливаемое PWA на русском языке.

- Без регистрации работает всё: данные гостя хранятся в браузере (IndexedDB) и не уходят на сервер.
- Аккаунт (по желанию, на собственном сервере) — серверное хранение, синхронизация и общий доступ семьи.
- Основные возможности бесплатны; подписок, оплаты и обязательного AI нет.

Задание и согласованные решения владельца — [`docs/SPEC.md`](docs/SPEC.md). Постоянные правила разработки — [`CLAUDE.md`](CLAUDE.md). Текущее состояние и результаты проверок — [`docs/STATUS.md`](docs/STATUS.md).

## Где посмотреть

| Что | Где |
| --- | --- |
| Тестовый сайт (гостевой режим, GitHub Pages) | `https://lucky2356.github.io/Foodo/` — публикуется workflow **Pages** после слияния в `main` |
| Релизы (архив сайта, `SHA256SUMS`, compose) | вкладка **Releases** репозитория |
| Docker-образы | `ghcr.io/lucky2356/foodo-api`, `ghcr.io/lucky2356/foodo-web` |

## Путь через GitHub Actions (на компьютере владельца ничего не нужно)

| Workflow | Когда | Что делает |
| --- | --- | --- |
| `CI` (`.github/workflows/ci.yml`) | каждый PR и push в `main` | ESLint, TypeScript, vitest; ruff, mypy, проверка миграций, pytest на PostgreSQL 16; Playwright (гость и аккаунт); сборка Docker-образов, чистый запуск, health, перезапуск с сохранением БД |
| `Pages` (`pages.yml`) | push в `main`, вручную | статическая сборка (гостевой режим) → GitHub Pages |
| `Release` (`release.yml`) | вручную на `main` | все проверки CI → образы в GHCR → архив сайта и `SHA256SUMS` → Sigstore-аттестации → тег `vX.Y.Z` и GitHub Release |
| `Prices` (`prices.yml`) | еженедельно, вручную; пробный прогон в PR | средние цены Росстата по регионам и городам, цены сайта «Магнита»; коммит в `shared/data/prices` и пересборка Pages — [`docs/PRICES.md`](docs/PRICES.md) |
| `Photos` (`photos.yml`) | вручную; в PR при изменении выбора | кандидаты из Wikimedia Commons на контактных листах для проверки и применение выбранных фото с авторством и лицензией — [`docs/PHOTOS.md`](docs/PHOTOS.md) |

Выпуск версии: обновить `VERSION`, `frontend/package.json` и раздел в `CHANGELOG.md` через PR, слить, затем **Actions → Release → Run workflow** (ветка `main`).

Проверка подписи релиза (любой компьютер с `gh`):

```sh
gh attestation verify foodo-web-static-0.1.0.zip -R Lucky2356/Foodo
gh attestation verify oci://ghcr.io/lucky2356/foodo-api:0.1.0 -R Lucky2356/Foodo
```

Первый запуск **Pages** требует один раз включить Pages: *Settings → Pages → Build and deployment → Source: GitHub Actions*.

## Структура

```
backend/            Django 5.2 + DRF: API, аккаунты, семьи, меню, покупки, цены, админка
  engine/           Python-версия движка планирования (паритет с TypeScript)
frontend/           React 19 + TypeScript + Vite 7, PWA
  src/engine/       TypeScript-движок: генератор меню, КБЖУ, покупки, витамины
  src/data/         IndexedDB гостя, шлюзы гостя и аккаунта, импорт/экспорт
  e2e/              Playwright: гостевой и аккаунт-сценарии
shared/data/        Стартовые данные: справочники, продукты, рецепты, нормы, города, сети
shared/fixtures/    Общие тест-кейсы движка и ожидаемые результаты (TS ⇄ Python)
deploy/             nginx и Caddy для production
scripts/prices/     Сбор цен (Росстат, сайты сетей) и публикация для статического сайта
scripts/photos/     Поиск и применение фотографий из Wikimedia Commons
docs/               Задание, архитектура, правила питания, витамины, цены, фото, развёртывание, статус
.github/workflows/  CI, Pages, Release
```

## Команды разработчика

Для разработки в облачной среде или у участника проекта (не на компьютере владельца). Требуются Node 22, Python 3.13 и PostgreSQL 16 (или Docker).

```sh
# Frontend
cd frontend
npm ci
npm run dev            # http://localhost:5173, /api проксируется на 127.0.0.1:8000
npm run lint
npm run typecheck
npm test               # vitest: движок, хранилище гостя, экспорт
npm run build          # сборка для сервера (nginx + API)
npm run build:static   # сборка для GitHub Pages (только гостевой режим)
npm run e2e            # Playwright, гостевой режим
E2E_ACCOUNT=1 npm run e2e   # Playwright, аккаунт (нужен API на :8000 с данными)
npm run fixtures:write # пересоздать ожидаемые результаты shared/fixtures/engine

# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install --require-hashes -r requirements.txt -r requirements-dev.txt
export DATABASE_URL=postgres://foodo:foodo@127.0.0.1:5432/foodo DJANGO_DEBUG=1
python manage.py migrate
python manage.py load_seed        # идемпотентно: справочники, продукты, рецепты, нормы, города, сети
python manage.py runserver
ruff check . && ruff format --check . && mypy
pytest                             # только PostgreSQL

# Весь стек в Docker: http://localhost:8080
docker compose up --build
```

Сбор цен и фото (обычно в GitHub Actions; локально — для разработки):

```sh
pip install --require-hashes -r scripts/prices/requirements.txt
python -m scripts.prices.run --dry-run          # собрать и показать сводку, ничего не записывая
python -m scripts.prices.publish frontend/public/data/prices
python -m pytest -p no:django scripts/prices/tests scripts/photos/tests
```

Импорт данных администратором: `python manage.py import_catalog <file.json>` (продукты/рецепты, с проверкой связей и единиц, без дублей при повторе) и `python manage.py import_prices <file.json> --kind scraped|rosstat`. Те же импорты доступны в Django Admin.

## Лицензия

Лицензия не выбрана: это отдельное решение владельца. Шрифты DejaVu (экспорт PDF) распространяются по своей лицензии — `frontend/public/fonts/DejaVu-LICENSE.txt`; Onest — SIL OFL через `@fontsource-variable/onest`.
