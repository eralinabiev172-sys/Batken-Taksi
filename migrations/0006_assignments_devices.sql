-- Up Migration

-- Stage 3.2.3: driver-bus and gps-device-bus assignments (versioned, no overlaps).

CREATE TABLE driver_bus_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  driver_user_id uuid NOT NULL REFERENCES users (id),
  bus_id         uuid NOT NULL REFERENCES buses (id),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX dba_driver_idx ON driver_bus_assignments (driver_user_id, valid_from);
CREATE INDEX dba_bus_idx ON driver_bus_assignments (bus_id, valid_from);
-- Prevent overlapping active assignments for the same driver or bus.
ALTER TABLE driver_bus_assignments
  ADD CONSTRAINT dba_no_overlap_driver EXCLUDE USING gist (
    driver_user_id WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  ) WHERE (revoked_at IS NULL),
  ADD CONSTRAINT dba_no_overlap_bus EXCLUDE USING gist (
    bus_id WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  ) WHERE (revoked_at IS NULL);

CREATE TABLE gps_devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id        text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  external_id      text NOT NULL UNIQUE CHECK (btrim(external_id) <> ''),
  manufacturer     text,
  model            text,
  order_code       text,
  serial_number    text,
  protocol         text,
  firmware         text,
  auth_mode        text NOT NULL DEFAULT 'per_device_secret' CHECK (auth_mode IN ('per_device_secret', 'tls_cert', 'apn_allowlist')),
  secret_reference text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'retired', 'archived')),
  last_seen_at     timestamptz,
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gps_devices_status_idx ON gps_devices (status);

CREATE TABLE gps_device_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gps_device_id  uuid NOT NULL REFERENCES gps_devices (id),
  bus_id         uuid NOT NULL REFERENCES buses (id),
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  reason         text,
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX gda_device_idx ON gps_device_assignments (gps_device_id, valid_from);
CREATE INDEX gda_bus_idx ON gps_device_assignments (bus_id, valid_from);
ALTER TABLE gps_device_assignments
  ADD CONSTRAINT gda_no_overlap_device EXCLUDE USING gist (
    gps_device_id WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  ) WHERE (revoked_at IS NULL),
  ADD CONSTRAINT gda_no_overlap_bus EXCLUDE USING gist (
    bus_id WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  ) WHERE (revoked_at IS NULL);

GRANT SELECT, INSERT, UPDATE ON driver_bus_assignments, gps_devices, gps_device_assignments TO busway_app;

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0006 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;