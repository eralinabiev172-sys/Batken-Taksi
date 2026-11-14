-- Up Migration

-- Stage 3.1 core schema. All timestamps are timestamptz (UTC, D-107).
-- Extensions are created by infra/db/init (superuser); IF NOT EXISTS keeps this idempotent.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE cities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id   text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  name_ru     text NOT NULL CHECK (btrim(name_ru) <> ''),
  name_ky     text NOT NULL CHECK (btrim(name_ky) <> ''),
  timezone    text NOT NULL DEFAULT 'Asia/Bishkek' CHECK (btrim(timezone) <> ''),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  email          text NOT NULL CHECK (btrim(email) <> ''),
  password_hash  text NOT NULL CHECK (btrim(password_hash) <> ''),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE TABLE user_roles (
  user_id     uuid NOT NULL REFERENCES users (id),
  role        text NOT NULL CHECK (role IN ('admin', 'driver')),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES users (id),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE driver_profiles (
  user_id     uuid PRIMARY KEY REFERENCES users (id),
  city_id     uuid NOT NULL REFERENCES cities (id),
  full_name   text NOT NULL CHECK (btrim(full_name) <> ''),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_profiles_city_idx ON driver_profiles (city_id);

-- Server-side sessions (D-105). Only a hash of the session token is stored.
CREATE TABLE sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users (id),
  token_hash            bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at   timestamptz NOT NULL,
  idle_expires_at       timestamptz NOT NULL,
  revoked_at            timestamptz,
  revoked_reason        text,
  CHECK (absolute_expires_at > created_at),
  CHECK (idle_expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (absolute_expires_at);

-- Append-only audit trail.
CREATE TABLE audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid REFERENCES users (id),
  action         text NOT NULL CHECK (btrim(action) <> ''),
  entity_type    text,
  entity_id      uuid,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id     text
);
CREATE INDEX audit_logs_occurred_idx ON audit_logs (occurred_at);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, occurred_at);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- Least privilege for the application role. audit_logs: no UPDATE, no DELETE.
GRANT USAGE ON SCHEMA public TO busway_app;
GRANT SELECT, INSERT, UPDATE ON cities, users, user_roles, driver_profiles, sessions TO busway_app;
GRANT DELETE ON sessions TO busway_app;
GRANT SELECT, INSERT ON audit_logs TO busway_app;

-- Down Migration

-- Extensions are owned by the superuser and are intentionally not dropped here.
DROP TABLE IF EXISTS audit_logs;
DROP FUNCTION IF EXISTS audit_logs_immutable();
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS driver_profiles;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS cities;
