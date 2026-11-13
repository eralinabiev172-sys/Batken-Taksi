# Безопасность BusWay KG

## Статус

Версия 1.1, 13 ноября 2026 года. Минимальные обязательные меры MVP; конкретные hardware-возможности проверяются до Этапа 4. Метка `[v1.2]` — изменение по согласованному Баткенскому обновлению; прежние формулировки v1.0 приведены в §12. Этап 2 реализует только явно маркированный frontend-демо: серверная защита не реализована и не заявляется.

## 1. Модель доверия

Браузер, пользовательские параметры, GPS-пакеты, device ID и внешние timestamps недоверенные. Только Fastify определяет роль, назначения, разрешение публичной видимости, допустимость позиции и публичную публикацию. `[v1.2]` Аппаратный трекер — единственный production-источник координат, но сам факт знания IMEI/device ID не доказывает подлинность.

## 2. Матрица доступа

| Действие | Гость | Пассажир | Водитель | Админ | GPS gateway |
|---|:---:|:---:|:---:|:---:|:---:|
| Публичная карта/маршруты | ✓ | ✓ | ✓ | ✓ | — |
| Свои назначение/рейс/health | — | — | ✓ | ✓ | — |
| Начать/закончить свой рейс | — | — | ✓ | управляет | — |
| Включить/выключить публичный показ своего автобуса `[v1.2]` | — | — | ✓ | по отдельному праву | — |
| Управлять парком/трекерами | — | — | — | ✓ | — |
| Передать аппаратную позицию | — | — | — | — | ✓ |
| GPS-история и аудит | — | — | ограниченно | ✓ | — |
| Служебная позиция всех автобусов и история grants `[v1.2]` | — | — | — | защищённо | — |

Проверка роли и объекта выполняется для каждого endpoint и события. Водитель не выбирает произвольный автобус или tracker ID.

## 3. Пользовательская аутентификация

- Argon2id для паролей; параметры выбираются измерением.
- `HttpOnly`, `Secure`, `SameSite` cookies; session rotation и отзыв.
- CSRF token и Origin check для изменяющих запросов.
- Rate limit входа и одинаковые безопасные сообщения об ошибке.
- Bootstrap первого администратора выполняется защищённой процедурой.
- MFA администратора рекомендуется до production; окончательный механизм остаётся решением реализации (D-111).

## 4. GPS security baseline

Оборудование допускается к production только после проверки:

1. Настраиваемого собственного server endpoint.
2. Документированного протокола и совместимости с Traccar.
3. Локального offline buffer.
4. Уникальной конфигурации устройства и замены заводских паролей.
5. TLS с проверкой сервера и per-device secret/certificate, если модель это поддерживает.
6. Если TLS/уникальная аутентификация отсутствуют — private APN/VPN и сетевой allowlist обязательны как компенсирующая мера.
7. IMEI-only через открытый plain TCP/UDP без компенсирующей защиты для production не допускается.
8. Возможности блокировки/отзыва устройства и безопасной замены.

Точная модель, firmware, protocol и SIM-оператор остаются открытыми до аппаратной интеграции.

## 5. Изоляция Traccar

- неизвестные устройства не создаются автоматически;
- наружу открыт только необходимый device protocol port;
- Traccar UI/API закрыты private network/firewall;
- forwarding в Fastify аутентифицирован и доступен только внутри инфраструктуры;
- отдельные service/DB credentials и least privilege;
- удалённые команды трекерам выключены в MVP;
- patching, backup, restore и журналирование обязательны.

## 6. Валидация GPS

Fastify проверяет:

- зарегистрированное и не заблокированное устройство;
- активное tracker→bus assignment;
- checksum/decoder result, gateway position ID и sequence, если доступны;
- duplicate/replay;
- `measured_at`, `received_at`, clock skew и порядок;
- диапазоны координат, speed, heading, accuracy;
- невозможные скачки и аномальную частоту;
- действующее разрешение публичной видимости перед публикацией. `[v1.2]`

Аномальная точка отклоняется либо хранится с закрытым validation status, но не публикуется автоматически. Delayed-позиция не перезаписывает более новую live-позицию.

## 7. Публичная видимость, publication и privacy

Публичная карта получает только минимальную DTO без имени водителя, IMEI, serial, SIM, IP и внутренних ID. Позиции без действующего grant не публикуются. `[v1.2]` GPS-history доступна только минимально необходимым ролям. Логи не содержат секреты и без необходимости не содержат полные raw payload/координаты.

Правила visibility `[v1.2]`:

1. Grant хранится сервером с абсолютным UTC `expires_at`; cutoff принимается только для текущего дня `Asia/Bishkek`.
2. Фоновый таймер удобен, но право проверяется при каждом REST snapshot и realtime event.
3. Ручное отключение/истечение немедленно прекращает публичную выдачу и рассылает `vehicle.removed` подключённым клиентам.
4. Delayed/replayed/reconciled GPS не включает grant и не возвращает автобус.
5. Restart сохраняет только неистёкшее DB-состояние; следующий день требует нового действия водителя.
6. Завершение рейса, endpoint, geofence и смена направления grant не меняют.
7. Enable/disable/expire и служебный доступ администратора журналируются.
8. Непубличная геолокация доступна только минимальным admin permissions; retention ограничивается.

## 8. Web/API security

HTTPS/WSS, HSTS, строгий CORS, CSP, JSON Schema, body/rate limits, parameterized SQL, запрет mass assignment, object-level authorization, безопасные ошибки, dependency/secret scanning. Публичные snapshot/WS endpoints защищаются от excessive subscriptions и scraping в разумных пределах, не требуя регистрации пассажира.

React/Leaflet не строит HTML маркеров из DTO: текст выводится React-компонентами или `textContent`, цвета валидируются; Этап 2 использует `CircleMarker`/`Tooltip`. `[v1.2]` Внешние ресурсы (шрифты, тайлы) выбираются с учётом приватности пользователей.

## 9. Recovery и эксплуатационная безопасность

Forward retry не считается гарантированной доставкой. Постоянная БД Traccar, идемпотентный Fastify ingest и reconciliation обязательны. Наблюдаются GPS lag, unknown/rejected devices, forwarding failures, reconciliation backlog, disk, DB и WebSocket connections; дополнительно сбои grant expiry/removal. `[v1.2]` До production проходят backup/restore и restart tests.

## 10. Основные угрозы

| Угроза | Мера |
|---|---|
| Подмена device ID | TLS/per-device credential либо private APN/VPN; allowlist; anomaly detection |
| Подмена автобуса | Серверное tracker→bus assignment, клиентский busId не доверяется |
| Replay/duplicate | Position ID/sequence/timestamp/hash и unique constraints |
| Публикация без разрешения водителя `[v1.2]` | Assignment + grant gate на каждом выводе; атомарное удаление live projection при manual/expiry |
| Чужой автобус `[v1.2]` | Server session и object-level authorization при enable/disable |
| Republish старым пакетом `[v1.2]` | GPS ingest не меняет grant; delayed/reconciled не возвращает отключённый автобус |
| Автовключение после restart/ночи `[v1.2]` | Persisted absolute expiry, проверка при запросе, новое ручное включение на следующий день |
| Утечка служебной геолокации admin `[v1.2]` | Отдельное permission, аудит, retention, least privilege |
| Старые данные как live | Freshness thresholds и monotonic live update |
| Потеря forwarding | Traccar DB + retry + reconciliation |
| Захват user session | Secure cookie, rotation, expiry, TLS, MFA admin |
| IDOR/роль | Проверка роли и объекта на сервере |
| SQL/XSS/CSRF | Schema, parameterization, escaping/CSP, CSRF+Origin |
| Утечка GPS/PII | Минимальная DTO, least privilege, retention, masked logs |

## 11. Открытые решения

Механизм MFA/bootstrap, session timeouts, окончательные rate limits и anomaly thresholds, retention, точность публичных координат, законодательные требования Кыргызстана и concrete hardware security; дополнительно `[v1.2]`: максимальный срок показа offline-позиции (D-133) и гранулярность admin permissions для служебной геолокации. Они проверяются до соответствующей реализации и production; запрет IMEI-only остаётся обязательным.

## 12. История изменений v1.0 → v1.1

Заменённые формулировки (дословно):

- §1: «Только Fastify определяет роль, назначения, активный рейс, допустимость позиции и публичную публикацию.»
- §6: «соответствие активному рейсу перед публикацией».
- §7: «Позиции до начала и после завершения рейса не публикуются.»
- §10: строка «Публикация вне рейса — Active-trip publication gate и атомарное удаление live state».

Основание: D-127, D-130–D-132 (`DECISIONS.md`).
