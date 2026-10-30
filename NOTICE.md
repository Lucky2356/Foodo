# Foodo — авторство и лицензии

Copyright © 2026 Lucky (https://github.com/Lucky2356). Исходный репозиторий: https://github.com/Lucky2356/Foodo

## Код — GNU AGPL-3.0

Исходный код Foodo (`backend/`, `frontend/`, `scripts/`, `deploy/`, `.github/` и остальные файлы, если ниже не сказано иное) распространяется по лицензии **GNU Affero General Public License версии 3** (`AGPL-3.0-only`), полный текст — в файле [`LICENSE`](LICENSE).

Коротко (не заменяет текст лицензии): код можно бесплатно использовать, изучать, изменять и распространять. Изменённую версию нужно распространять под той же лицензией, а если она работает как сайт или сервис, её пользователям должен быть доступен исходный код.

### Дополнительное условие (раздел 7(b) AGPL-3.0)

Любая изменённая версия Foodo и любая работа на его основе, у которой есть пользовательский интерфейс, обязана сохранять в показываемых пользователю юридических сведениях (Appropriate Legal Notices) — например, на странице «О сервисе» — видимую надпись:

> Основано на Foodo — автор Lucky (https://github.com/Lucky2356)

со ссылкой на исходный репозиторий https://github.com/Lucky2356/Foodo.

*Additional term under section 7(b) of the AGPL-3.0: every modified version of Foodo and every work based on it that has a user interface must preserve, in the Appropriate Legal Notices it displays (for example, an "About" page), the visible attribution "Based on Foodo — author Lucky (https://github.com/Lucky2356)" with a link to the original repository https://github.com/Lucky2356/Foodo.*

## Рецепты, статьи и тексты — CC BY-SA 4.0

Рецепты, статьи и справочные данные каталога в `shared/data/` (`recipes.json`, `articles.json`, `products.json`, `reference.json`) распространяются по лицензии **Creative Commons Attribution-ShareAlike 4.0 International** (`CC-BY-SA-4.0`), полный текст — в файле [`LICENSE-CONTENT`](LICENSE-CONTENT). При использовании укажите: «Foodo, автор Lucky (https://github.com/Lucky2356)» и ссылку на лицензию; переработки распространяются под той же лицензией.

## Исключения — материалы третьих лиц

У этих материалов свои авторы и лицензии; лицензии Foodo на них не распространяются:

- **Фотографии блюд** — у каждой фотографии свой автор и свободная лицензия, они указаны в карточке рецепта и в `shared/data/photos/`.
- **Справочник городов** (`shared/data/geo/`) — hflabs/city, CC BY-SA 4.0 (HFLabs).
- **Цены** (`shared/data/prices/`) — сведения из открытых источников: средние цены Росстата и цены с открытых страниц сетей; источник указан у каждой записи.
- **Пищевая ценность из USDA FoodData Central** — у продуктов с источником `usda-sr-legacy-2018` в `shared/data/products.json`, а также `scripts/catalog/sources/usda_values.json`: значения набора SR Legacy (апрель 2018) Министерства сельского хозяйства США, общественное достояние (CC0 1.0); источник указывается как «U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, SR Legacy, 2018». Сопоставление продуктов Foodo с записями набора — часть Foodo.
- **Пищевая ценность из Livsmedelsverket** — у продуктов с источником `livsmedelsverket` в `shared/data/products.json`, а также `scripts/catalog/sources/livsmedel_values.json`: данные Livsmedelsdatabasen Шведского агентства по продовольствию (Livsmedelsverket), лицензия CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Изменения Foodo: углеводы пересчитаны по разности, отобраны формы витаминов, совпадающие с формами Foodo (подробно — `docs/NUTRIENTS.md`).
- **Нормы витаминов** (`shared/data/nutrient_targets.json`) — значения из методических рекомендаций МР 2.3.1.0253-21 (официальный документ).
- **Шрифты** — Onest (SIL Open Font License 1.1), DejaVu Sans (`frontend/public/fonts/DejaVu-LICENSE.txt`).
- **Зависимости** (npm, PyPI, Android) — по своим лицензиям.
