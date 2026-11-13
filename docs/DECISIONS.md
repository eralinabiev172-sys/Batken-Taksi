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
| D-102 | Поддерживаемые LTS Node.js и Fastify; точные версии проверить перед реализацией | APPROVED, versions DEFERRED |
| D-103 | PostgreSQL/PostGIS и SQL migrations; конкретная ORM открыта | APPROVED, ORM PROPOSED |
| D-104 | Контрактные JSON schemas/OpenAPI; TypeBox остаётся вариантом | APPROVED, library PROPOSED |
| D-105 | Server-side sessions, secure cookies, CSRF, Argon2id | APPROVED |
| D-106 | Unit/integration/contract/E2E/security/recovery/load/hardware strategy | APPROVED |
| D-107 | UTC; отдельно measured/received/published times; ID format уточнить | APPROVED, ID format DEFERRED |
| D-108 | Одна основная привилегированная роль аккаунта в MVP | PROPOSED |
| D-109 | Опубликованные маршруты должны сохранять историческую версию | PROPOSED |
| D-110 | Сменяемый OSM-compatible tile provider; конкретный provider до production | APPROVED, provider DEFERRED |
| D-111 | MFA администраторов до production | PROPOSED |
| D-112 | Карта без регистрации; жалобы подтверждаются email | APPROVED |
| D-113 | npm monorepo: `apps/web`, `apps/api`, `packages/contracts`, `infra/traccar` | PROPOSED |
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
