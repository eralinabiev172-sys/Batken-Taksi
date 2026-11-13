# API и realtime BusWay KG

## Статус

Версия 1.1, 13 ноября 2026 года. Контракты MVP Этапа 1; endpoint-ы не реализованы (Этап 2 использует только локальный in-memory adapter без fetch/WebSocket). Базовый путь `/api/v1`, JSON, UTC. Метка `[v1.2]` — изменение по согласованному Баткенскому обновлению; прежние формулировки v1.0 приведены в §12.

## 1. Общие правила

- Production использует HTTPS/WSS.
- Изменения требуют server session, CSRF-защиты и нужной роли.
- Сервер не доверяет переданным `busId`, `driverId`, `trackerId` без object-level проверки.
- Ошибка: `{ "error": { "code", "message", "details?", "requestId" } }`.
- Растущая история использует cursor pagination.
- Критические команды и GPS ingest идемпотентны.

## 2. Авторизация

| Метод | Путь | Доступ |
|---|---|---|
| POST | `/auth/login` | Гость |
| POST | `/auth/logout` | Авторизованный |
| GET | `/auth/me` | Авторизованный |
| POST | `/auth/csrf-token` | По политике сессии |

Водителей и администраторов создаёт уполномоченный администратор/защищённый bootstrap. Публичная карта не требует регистрации.

## 3. Публичное API MVP

| Метод и путь | Результат |
|---|---|
| `GET /cities` | Активные города/регионы (первая запись — Баткенский район) `[v1.2]` |
| `GET /cities/:cityId/routes?query=` | Поиск/список маршрутов |
| `GET /routes/:routeId` | Маршрут, направления и остановки; `geometry` направления может быть `null` до утверждения `[v1.2]` |
| `GET /cities/:cityId/vehicles/live?routeId=&bbox=` | Snapshot автобусов с действующим grant `[v1.2]` |
| `GET /trips/:publicTripId` | Безопасная публичная информация рейса автобуса с действующим grant `[v1.2]` |

Публичная позиция содержит `vehiclePublicId`, маршрут/направление, координаты, `measuredAt`, `lastUpdatedAt`, `freshness` и допустимые speed/heading. Она не содержит водителя, IMEI, tracker ID, SIM и внутренних ID. Grant проверяется при каждом запросе. `[v1.2]`

`POST /journeys/search`, arrivals/ETA, история и жалобы относятся к последующим этапам и не блокируют live-карту.

## 4. API водителя

| Метод и путь | Назначение |
|---|---|
| `GET /driver/assignment` | Назначенные автобус и маршрут |
| `GET /driver/trips/active` | Собственный активный рейс |
| `POST /driver/trips` | Начать разрешённый рейс |
| `POST /driver/trips/:id/complete` | Завершить собственный рейс; публичный показ не меняется `[v1.2]` |
| `GET /driver/tracker-status` | Last seen, freshness и health трекера автобуса |
| `GET /driver/public-visibility` | Текущий grant и серверный remaining time `[v1.2]` |
| `POST /driver/public-visibility` | Включить показ до cutoff текущего дня `Asia/Bishkek` `[v1.2]` |
| `DELETE /driver/public-visibility` | Немедленно выключить показ вручную `[v1.2]` |
| `POST /driver/fault-reports` | Сообщить о неисправности |

Водительский браузер не отправляет GPS. Сервер выводит автобус из действующего назначения. Правило старта при `stale/offline` задаётся продуктовым решением; базовое предложение — разрешить с явным предупреждением и audit event.

Пример ответа grant `[v1.2]`: `{ "enabled": true, "enabledAt": "…Z", "expiresAt": "…Z", "remainingSeconds": 14320 }`. Countdown в UI вычисляется для отображения и не даёт права публикации.

## 5. API администратора

CRUD означает list/get/create/update/archive без физического удаления истории:

- `/admin/drivers`, `/admin/buses`;
- `/admin/routes`, `/admin/route-directions`, `/admin/stops`, `/admin/route-stops`;
- `/admin/driver-assignments`;
- `/admin/gps-devices`, `/admin/gps-device-assignments`;
- `/admin/trips`, `/admin/live-vehicles`, `/admin/tracker-health`;
- `/admin/public-visibility-grants` (текущие grants, время отключения, история) `[v1.2]`;
- `/admin/fault-reports`, `/admin/audit-logs`;
- complaints/statistics — после реализации соответствующего этапа.

Регистрация устройства требует явного admin-действия. Замена трекера закрывает прежнее назначение и создаёт новое без пересечения. Непубличная геолокация требует отдельного admin permission и аудита. `[v1.2]`

## 6. Внутренний GPS ingest

Пример логического endpoint: `POST /internal/v1/gps/positions`. Он не доступен публичным браузерам.

Минимальная нормализованная запись:

```json
{
  "gatewayPositionId": "123456",
  "deviceExternalId": "device-id",
  "measuredAt": "2026-11-13T08:29:59.500Z",
  "receivedAt": "2026-11-13T08:30:00.100Z",
  "sequence": "optional-protocol-record-id",
  "position": { "latitude": 42.8746, "longitude": 74.5698 },
  "speedMps": 8.1,
  "headingDeg": 91,
  "accuracyM": 12.4,
  "attributes": {}
}
```

(Значения координат — формат-пример из версии 1.0, не относятся к Баткенскому району.)

Требования:

- private network/firewall и отдельная gateway-аутентификация;
- body/schema/rate limits;
- allowlist зарегистрированных устройств;
- dedupe по gateway position ID, иначе устойчивому составному ключу;
- проверка timestamp, sequence, координат, скорости и аномальных скачков;
- идемпотентный ответ для forwarding и reconciliation;
- сохранение rejection reason без утечки секретов.

Принятая GPS-точка сама никогда не включает публичность: после ingest Fastify проверяет актуальный grant. `[v1.2]`

## 7. Reconciliation API

Fastify получает из закрытого Traccar API позиции по устройству и временному окну. Окна перекрываются, cursor продвигается только после полной успешной обработки. Reconciliation использует ту же validation/ingest-функцию, что forwarding, поэтому повтор не создаёт дубликат.

Forward retry покрывает только короткий отказ. Постоянная БД Traccar и reconciliation обязательны для длительного восстановления. Восстановленная позиция не может вернуть отключённый или истёкший автобус на карту. `[v1.2]`

## 8. WebSocket к браузерам

Endpoint: `WSS /ws/v1/live`. Гость может подписываться только на публичные маршруты/область; водитель и администратор получают разрешённые дополнительные статусы.

Серверные события:

- `snapshot` — полное текущее состояние подписки;
- `vehicle.position` — новая разрешённая позиция;
- `vehicle.freshness` — изменение актуальности;
- `vehicle.removed` — ручное отключение показа, истечение grant, отзыв назначения или offline policy; завершение рейса, прибытие и geofence не являются причиной `[v1.2]`;
- `tracker.health` — только разрешённым водителю/администратору;
- `error`, `ping`, `pong`.

После reconnect клиент заново получает REST/WS snapshot и не полагается на доставку всех промежуточных событий.

## 9. Freshness и публикация

Базовые пороги: `live ≤6s`, `delayed >6–20s`, `stale >20–60s`, `offline >60s` по проверенному `measuredAt`. Публичное событие возможно только при действующем grant и действующих назначениях. `[v1.2]` Delayed/reconciled позиция не заменяет более новую live-позицию.

## 10. Ошибки

Общие коды: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`.

Доменные коды: `NO_ACTIVE_ASSIGNMENT`, `ACTIVE_TRIP_EXISTS`, `TRIP_NOT_ACTIVE`, `TRACKER_UNKNOWN`, `TRACKER_BLOCKED`, `TRACKER_NOT_ASSIGNED`, `GPS_DUPLICATE`, `GPS_OUT_OF_ORDER`, `GPS_REJECTED`, `GPS_STALE`; добавлены `[v1.2]`: `FORBIDDEN_BUS`, `INVALID_CUTOFF_TIME`, `CUTOFF_MUST_BE_FUTURE`, `VISIBILITY_ALREADY_DISABLED`.

## 11. Версионирование и открытые детали

REST и WS имеют major version; optional fields совместимы. OpenAPI/TypeBox, точный idempotency header, pagination DTO, WS subscription limits и окончательные threshold-ы уточняются до реализации соответствующего контракта. Конкретный аппаратный протокол остаётся между трекером и Traccar и не становится публичным API BusWay KG.

## 12. История изменений v1.0 → v1.1

Заменённые формулировки (дословно):

- §3: «`GET /cities/:cityId/vehicles/live?routeId=&bbox=` — Snapshot активных автобусов»; «`GET /trips/:publicTripId` — Безопасная публичная информация активного рейса».
- §8: «`vehicle.removed` — рейс завершён, отменён или перешёл в offline policy».
- §9: «Публичное событие возможно только при активном рейсе и действующих назначениях.»

Основание: D-127, D-130, D-131 (`DECISIONS.md`).
