# База данных BusWay KG

## Статус

Версия 1.1, 13 ноября 2026 года. Логическая модель упрощённого MVP; миграции и программный код не создавались. СУБД: PostgreSQL + PostGIS. Метка `[v1.2]` — изменение по согласованному Баткенскому обновлению; прежние формулировки v1.0 приведены в §9.

## 1. Принципы

- PostgreSQL — источник истины бизнес-данных BusWay KG.
- Traccar хранит собственные позиции для protocol gateway и reconciliation.
- Live state отделён от неизменяемой GPS-истории.
- Устройство, автобус, водитель и рейс — разные сущности с версионируемыми назначениями.
- Геометрия использует SRID 4326, серверное время — UTC; пользовательский cutoff интерпретируется в `Asia/Bishkek`. `[v1.2]`
- Исторические записи архивируются, а не каскадно удаляются.

## 2. Основные связи

```text
city 1──N route 1──N route_direction 1──N route_stop N──1 stop
city 1──N bus
user 1──0..1 driver_profile
driver_profile 1──N driver_bus_assignment N──1 bus
gps_device 1──N gps_device_assignment N──1 bus
driver_bus_assignment 1──N trip N──1 route_direction
driver_bus_assignment 1──N public_visibility_grant        [v1.2]
trip 1──N gps_position
bus 1──0..1 vehicle_live_state
gps_device 1──N gps_gateway_message
user(admin) 1──N audit_log
```

Первая запись `city` — Баткенский район (область/район/город — единая сущность территории; переименование в `region` остаётся открытым вопросом, не решённым владельцем). `[v1.2]`

## 3. MVP-таблицы

### Доступ

- `users`: id, email/phone, password_hash, status, display_name, timestamps.
- `user_roles`: user_id, role (`passenger|driver|admin`); допустимость нескольких ролей одному аккаунту определяется D-108.
- `driver_profiles`: user_id, internal_number, phone, status, admin_note.
- `sessions`: id/token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at.

### Маршруты

- `cities`: id, names RU/KY, country_code, timezone, bounds, is_active.
- `stops`: id, city_id, names RU/KY, code, `geography(Point,4326)`, archived_at.
- `routes`: id, city_id, public_number, names RU/KY, color, status, version/timestamps.
- `route_directions`: id, route_id, names/headsign RU/KY, `geometry(LineString,4326)` (nullable, пока геометрия не утверждена), `geometry_status` `[v1.2]`, status.
- `route_stops`: direction_id, stop_id, sequence; уникальная положительная последовательность.

Маршрут №1 имеет два независимых направления; обе геометрии пока `pending` (D-126). Промежуточные остановки не создаются. `[v1.2]`

### Парк и назначения

- `buses`: id, city_id, internal_number, plate_number, make/model, capacity, status, timestamps.
- `driver_bus_assignments`: id, driver_user_id, bus_id, valid_from/to, created_by/at, revoked_at.
- `gps_devices`: id, unique external_id, manufacturer, model, order_code, serial, protocol, firmware, auth_mode, secret_reference, status, last_seen_at, timestamps.
- `gps_device_assignments`: id, gps_device_id, bus_id, valid_from/to, created_by/at, reason, revoked_at.
- `sim_cards`: необязательная operational-таблица: ICCID, operator, APN, status, device_id; оператор и тариф не фиксируются архитектурой.

Пересекающиеся активные назначения одного водителя, автобуса или трекера запрещаются ограничениями диапазонов.

### Рейсы и GPS

- `trips`: id, driver_assignment_id, immutable driver_user_id/bus_id, route_direction_id, status, started_at, ended_at, timestamps. Независимое операционное состояние, не publication gate. `[v1.2]`
- `gps_positions`: id, source_position_id, gps_device_id, bus_id, nullable trip_id, position, measured_at, received_at, speed, heading, altitude, accuracy, protocol_sequence, delayed, validation_status/reason, raw_hash.
- `vehicle_live_states`: bus_id PK, trip_id, gps_position_id, position, measured_at, received_at, freshness, speed, heading, updated_at.
- `gps_gateway_messages`: минимальные диагностические метаданные gateway/device/source ID, received_at, processing_status, rejection_reason, raw_hash. Raw payload по умолчанию не хранится.
- `gps_reconciliation_cursors`: device/gateway, durable cursor/window, last_success_at, backlog/error state.

### Разрешение публичной видимости `[v1.2]`

`public_visibility_grants`: `id`, `driver_assignment_id`, immutable `driver_user_id`, `bus_id`, `enabled_at`, `expires_at`, `disabled_at`, `disabled_reason` (`manual|expired|admin|assignment_revoked`), `created_at`.

- grant создаёт только назначенный водитель;
- `expires_at > enabled_at`, cutoff относится к тому же дню `Asia/Bishkek`;
- один действующий grant на bus/assignment;
- публичный запрос всегда требует `disabled_at IS NULL AND expires_at > server_now`;
- restart не меняет сохранённый неистёкший grant; истёкший считается выключенным даже до фоновой задачи;
- enable/disable/expire пишутся в append-only audit;
- start/end рейса, endpoint и geofence grant не обновляют.

### Аудит и последующие модули

- `fault_reports`: trip, bus, driver, category, description, status, timestamps.
- `audit_logs`: actor, action, entity type/id, safe before/after, correlation_id, IP/user agent, result, created_at; append-only.
- `complaints`: email verification, category, text, nullable route/bus/trip, status и timestamps — реализуется на Этапе 5.

## 4. Целостность GPS

- `external_id` устройства уникален, но не считается самостоятельной аутентификацией.
- `source_position_id` уникален в пределах gateway; fallback dedupe key использует device, measured time, sequence и hash.
- Координаты, heading, speed, accuracy и timestamps имеют CHECK-ограничения.
- Live state обновляет только принятая позиция, более новая текущей.
- GPS связывается с рейсом только по серверным назначениям и времени измерения; отсутствие или завершение рейса не запрещает публикацию при действующем grant. `[v1.2]`
- Ручное отключение или истечение grant удаляет public live projection в той же транзакции. `[v1.2]`
- Историческая delayed-позиция не может перезаписать более новую live-позицию и не может вернуть отключённый автобус на карту. `[v1.2]`
- GPS ingest не создаёт и не продлевает grant. `[v1.2]`

## 5. Индексы

- GiST: stop location, route shape, GPS position.
- B-tree: `(trip_id, measured_at)`, `(gps_device_id, measured_at)`, `(bus_id, measured_at desc)`, statuses и FK; для grants `(bus_id, expires_at)`. `[v1.2]`
- Unique: gateway/source position ID и утверждённый fallback dedupe key.
- Partial unique: один активный рейс на водителя и автобус; один действующий grant на bus/assignment. `[v1.2]`

## 6. Хранение

До отдельного утверждения применяются проектные минимумы: Traccar и BusWay KG GPS должны храниться достаточно долго для reconciliation; рабочий ориентир — 7 дней. Off-trip diagnostics предлагается хранить до 24 часов (для позиций вне публичного разрешения — off-grant diagnostics `[v1.2]`). Сроки рейсов, аудита и жалоб уточняются до функций Этапа 5/production. Очистка выполняется только управляемой retention-задачей.

## 7. Миграции и восстановление

Миграции версионируются; PostGIS включается первой миграцией; схема проверяется на чистой БД и upgrade-path. Production-схема не меняется неявно при старте. До публикации выполняются backup и реальный restore drill как для BusWay KG, так и для необходимого состояния Traccar.

## 8. Открытые решения

Точная ORM/миграционная библиотека, UUID-формат, окончательный retention, партиционирование при росте, обязательные поля оборудования, SIM metadata и модель версионирования маршрутов; дополнительно `[v1.2]`: название сущности территории (`city`/`region`) и максимальный срок публичного показа offline-позиции. Эти параметры не изменяют утверждённую аппаратную GPS-архитектуру.

## 9. История изменений v1.0 → v1.1

Заменённые формулировки (дословно):

- §4: «Позиция вне интервала рейса не получает `trip_id` и не публикуется.»; «Завершение рейса удаляет его live state в той же транзакции.»; «GPS связывается с рейсом только по серверным назначениям и времени измерения.» (без оговорки о grant).

Основание: D-127, D-129–D-131 (`DECISIONS.md`).
