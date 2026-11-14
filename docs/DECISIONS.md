# Реестр решений BusWay KG

## Правила

Статусы: `APPROVED`, `PROPOSED`, `DEFERRED`, `REJECTED`, `SUPERSEDED`. Только владелец утверждает изменение требований. Открытое решение, намеренно перенесённое к аппаратной интеграции, не блокирует React UI. Исторические решения не удаляются: заменённое решение сохраняется со статусом `SUPERSEDED` и ссылкой на заменяющее.

Версия реестра: 1.1 (13 ноября 2026 года). Строки D-001…D-124 восстановлены дословно из версии 1.0; изменены только статусы D-001, D-008, D-009 и D-118 (см. поправку ниже).

## Базовые утверждённые решения

| ID | Решение | Статус |
|---|---|---|
| D-001 | Бишкек, 10 собственных автобусов; готовность к другим городам | SUPERSEDED by D-125 (часть «готовность к другим городам» сохраняется) |
| D-002 | Только React/Vite web для пассажира, водителя и администратора; desktop/Android/iPhone browser | APPROVED |
| D-003 | Аппаратные трекеры — единственный production GPS-source; mobile apps и browser GPS исключены | APPROVED |
| D-004 | Node.js/Fastify, PostgreSQL/PostGIS и WebSocket | APPROVED |
| D-005 | Минимальная цепочка Traccar→Fastify→PostgreSQL/PostGIS→WebSocket→React | APPROVED |
| D-006 | Целевая передача GPS на gateway каждые 2 секунды; без абсолютной гарантии при потере GNSS/сети | APPROVED |
| D-007 | RU/KY, адаптивный сайт, публичная карта без обязательной регистрации | APPROVED |
| D-008 | Водитель начинает/завершает рейс; администратор управляет парком, маршрутами и tracker assignments | APPROVED; уточнено D-127 (рейс не управляет публичной видимостью) |
| D-009 | Публикация только для активного рейса; last update и stale warning обязательны | SUPERSEDED by D-127 (требование last update и stale warning сохраняется) |
| D-010 | Дополнительные функции сохраняются в Этапе 5 и не блокируют live GPS MVP | APPROVED |
| D-011 | Покупка трекеров не блокирует Этап 2; настоящие GPS tests только с оборудованием | APPROVED |
| D-012 | Commit/push/deploy/закупки/платные сервисы — только по отдельному разрешению | APPROVED |

## Архитектурные решения MVP

| ID | Решение | Статус/примечание |
|---|---|---|
| D-101 | Fastify как модульный монолит; Traccar как отдельный инфраструктурный gateway | APPROVED |
| D-102 | Поддерживаемые LTS Node.js и Fastify; точные версии проверить перед реализацией | APPROVED, versions DEFERRED; уточнено 14.11.2026: OWNER APPROVED — CONDITIONAL (см. «Условное утверждение Этапа 3.1») |
| D-103 | PostgreSQL/PostGIS и SQL migrations; конкретная ORM открыта | APPROVED, ORM PROPOSED; уточнено 14.11.2026: OWNER APPROVED — CONDITIONAL, без ORM (см. «Условное утверждение Этапа 3.1») |
| D-104 | Контрактные JSON schemas/OpenAPI; TypeBox остаётся вариантом | APPROVED, library PROPOSED; уточнено 14.11.2026: OWNER APPROVED — CONDITIONAL, TypeBox (см. «Условное утверждение Этапа 3.1») |
| D-105 | Server-side sessions, secure cookies, CSRF, Argon2id | APPROVED |
| D-106 | Unit/integration/contract/E2E/security/recovery/load/hardware strategy | APPROVED |
| D-107 | UTC; отдельно measured/received/published times; ID format уточнить | APPROVED, ID format DEFERRED; часть «ID format» уточнена 14.11.2026: OWNER APPROVED — CONDITIONAL (см. «Условное утверждение Этапа 3.1»); часть про UTC и времена не менялась |
| D-108 | Одна основная привилегированная роль аккаунта в MVP | PROPOSED |
| D-109 | Опубликованные маршруты должны сохранять историческую версию | PROPOSED |
| D-110 | Сменяемый OSM-compatible tile provider; конкретный provider до production | APPROVED, provider DEFERRED |
| D-111 | MFA администраторов до production | PROPOSED |
| D-112 | Карта без регистрации; жалобы подтверждаются email | APPROVED |
| D-113 | npm monorepo: `apps/web`, `apps/api`, `packages/contracts`, `infra/traccar` | PROPOSED; уточнено 14.11.2026: OWNER APPROVED — CONDITIONAL для `apps/web`, `apps/api`, `packages/contracts` (см. «Условное утверждение Этапа 3.1»); `infra/traccar` относится к Этапу 4 |
| D-114 | Self-hosted Traccar с постоянной БД; не forwarder-only/in-memory | APPROVED |
| D-115 | Конкретную модель/order code/firmware выбрать и проверить на Этапе 4 | DEFERRED |
| D-116 | IMEI-only недостаточен; TLS/per-device credential либо private APN/VPN/allowlist | APPROVED; конкретный механизм DEFERRED |
| D-117 | Версионируемое tracker→bus assignment без пересечений, только через admin | APPROVED |
| D-118 | Off-trip GPS только restricted diagnostics; пассажирам никогда не публикуется | SUPERSEDED by D-127 и D-132 (закрытая служебная диагностика для администратора сохраняется) |
| D-119 | Retention должен покрывать reconciliation; ориентиры 7 дней GPS и 24 часа off-trip diagnostics | PROPOSED |
| D-120 | SIM-оператор, bands и тариф выбираются после теста покрытия/предложений | DEFERRED |
| D-121 | `live ≤6s`, `delayed >6–20s`, `stale >20–60s`, `offline >60s` | PROPOSED, проверить на Этапе 4 |
| D-122 | Remote tracker commands выключены в MVP | APPROVED |
| D-123 | Start рейса при stale/offline: предупреждение + audit, без молчаливого успеха | PROPOSED |
| D-124 | Резервный tracker и процедура замены определяются перед массовым запуском | DEFERRED |

## Поправка Баткенского MVP (согласована владельцем, 13 ноября 2026 года)

| ID | Решение | Статус |
|---|---|---|
| D-125 | Первый регион — Баткенская область, Баткенский район; маршрут №1 Кара-Булак ↔ Баткен; стартовый парк 3 автобуса; готовность к другим городам/регионам сохраняется | APPROVED |
| D-126 | До отдельного утверждения обоих GeoJSON `path=null`; показываются только школа и автовокзал и статус «Маршрут уточняется»; промежуточные остановки не придумываются | APPROVED |
| D-127 | Publication gate — отдельное разрешение (grant) водителя; trip/прибытие/geofence его не выключают | APPROVED |
| D-128 | Время отключения — только текущий день `Asia/Bishkek`; следующий день требует ручного включения | APPROVED |
| D-129 | Сохранённый неистёкший grant переживает restart backend; истёкший не восстанавливается | APPROVED |
| D-130 | Manual/expiry проверяются на каждом REST/WS output и вызывают `vehicle.removed` | APPROVED |
| D-131 | Delayed/reconciled GPS никогда не включает и не возобновляет grant | APPROVED |
| D-132 | Служебный GPS администратора отделён от публичного показа и защищён отдельными правами и аудитом | APPROVED |
| D-133 | Offline: последняя точка временно показывается с предупреждением; максимальный срок показа | DEFERRED |
| D-134 | Этап 2 — только локальная frontend-демонстрация; серверная защита, реальный GPS и WebSocket не заявляются | APPROVED |
| D-135 | Нейтральные записи Демо-автобус/Демо-водитель/DEMO-TRACKER 1–3; реальные номера и персональные данные не придумываются | APPROVED |

## Условное утверждение Этапа 3.1 (владелец, 14 ноября 2026 года)

Статус всех семи решений: **OWNER APPROVED — CONDITIONAL**. Это утверждение архитектурного направления, а не разрешение на реализацию. Точные версии взяты из проверенного Decision Approval Package и остаются условными до runtime-проверки совместимости. Установленный Node.js не обновляется. Начало Этапа 3.1 требует отдельного разрешения владельца (D-012). Ничего из перечисленного не установлено и не запущено.

| ID | Что утвердил владелец | Статус |
|---|---|---|
| D-102 | Backend: Node.js 24 LTS (кандидат ≥ v24.22.3), Fastify 5.x (кандидат 5.12.8), `pg` 8.x (кандидат 8.23.1) | OWNER APPROVED — CONDITIONAL |
| D-103 | SQL-миграции через `node-pg-migrate` (кандидат 9.0.0), параметризованные запросы PostgreSQL, без ORM | OWNER APPROVED — CONDITIONAL |
| D-104 | TypeBox, JSON Schema, генерация OpenAPI из схем; запрет неожиданных полей в изменяющих запросах | OWNER APPROVED — CONDITIONAL |
| D-107 | Внутренние идентификаторы — UUID; для публичных API — отдельные непрозрачные идентификаторы. UUID не заменяет RBAC и проверки владения объектом | OWNER APPROVED — CONDITIONAL |
| D-113 | npm workspaces: `apps/web`, `apps/api`, `packages/contracts`. Frontend Этапа 2 сохраняется; после перехода обязательны повторные проверки 31/31 unit/UI и 22/22 E2E | OWNER APPROVED — CONDITIONAL |
| D-136 | Язык backend: JavaScript ESM с JSDoc | OWNER APPROVED — CONDITIONAL |
| D-137 | Локальная БД: PostgreSQL 18 / PostGIS 3.7 в Docker, только локально, привязка к `127.0.0.1`; предварительно порт 5432; образ `postgis/postgis:18-3.7` — кандидат | OWNER APPROVED — CONDITIONAL |

Обязательные проверки до реализации и блокирующие условия:

| ID | Что проверить | Блокирует |
|---|---|---|
| D-102 | Совместимость Fastify 5.x с Node 24 (на официальной странице LTS Fastify тестирование указано для Node 20 и 22); актуальность версий на день начала; `engines` и lockfile | установку зависимостей и создание `apps/api` |
| D-103 | Совместимость `node-pg-migrate` с `pg` 8.x (peer `pg <9`); наличие обратных миграций | создание миграций |
| D-104 | Совместимость `typebox` (кандидат 1.4.7) и `@fastify/type-provider-typebox` (кандидат 6.3.0) с выбранным Fastify; схемы запрещают лишние поля | создание контрактов и маршрутов |
| D-107 | Публичные ID не раскрывают внутренние UUID; тесты IDOR и владения объектом | схему данных и публичный API |
| D-113 | Сохранение копии `apps/web/package-lock.json`; сравнение версий frontend-зависимостей; повтор lint, 31/31 unit/UI, 22/22 E2E, build, `npm audit` | переход на workspaces и создание корневого `package.json` |
| D-136 | Конфигурация ESLint/JSDoc для `apps/api` | создание исходников `apps/api` |
| D-137 | Свободен ли порт 5432 (на 14.11.2026 свободен, перепроверить; 5433 занят Docker Desktop); совместимость образа `18-3.7` (linux/amd64) и выбор digest; путь хранения данных; лицензия Docker Desktop; доступная оперативная память (на 14.11.2026 свободно около 0.6 ГБ из 7.2 ГБ) | запуск Docker и PostgreSQL |

Ни одно другое решение (PROPOSED, DEFERRED, SUPERSEDED) настоящим не изменено. D-133 остаётся открытым.

## Recovery — обязательное решение

Traccar forwarding retry используется только для коротких отказов. Fastify ingest идемпотентен. Периодическая reconciliation читает позиции из постоянной БД Traccar через закрытый API временными окнами с durable cursor и перекрытием. Delayed/recovered точка не заменяет более новую live-позицию и не возвращает на публичную карту автобус, для которого публичный показ отключён вручную или истёк (D-131).

## Решения, открытые без блокировки Этапа 2

- модель, order code, firmware и hardware protocol;
- SIM-оператор, bands, APN и тариф;
- TLS/client credential/private APN для выбранной модели;
- фактические цены и production hosting;
- tile provider;
- retention сверх минимума восстановления;
- точные библиотеки/версии, отмеченные выше;
- MFA/bootstrap details, роль-модель и start-when-offline policy;
- утверждённые GeoJSON двух направлений маршрута №1 (D-126);
- максимальный срок показа offline-позиции (D-133).

Эти вопросы должны быть закрыты до затрагивающего их этапа. D-115, D-116 implementation, D-120 и D-124 обязательны до приёмки аппаратной интеграции/production.

## Отменённые направления

| Решение | Статус |
|---|---|
| Flutter driver app | SUPERSEDED |
| Kotlin/Android foreground service | SUPERSEDED |
| Swift/iOS Core Location | SUPERSEDED |
| Browser/phone водителя как production GPS-source | SUPERSEDED |
| Водительский WebSocket `gps.position` | SUPERSEDED |
