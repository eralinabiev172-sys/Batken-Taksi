-- Up Migration

CREATE TABLE gps_positions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_position_id  text,
  gps_device_id       uuid NOT NULL REFERENCES gps_devices (id),
  bus_id              uuid NOT NULL REFERENCES buses (id),
  trip_id             uuid REFERENCES trips (id),
  position            geometry(Point, 4326) NOT NULL,
  measured_at         timestamptz NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  speed_mps           double precision,
  heading_deg         double precision,
  altitude_m          double precision,
  accuracy_m          double precision,
  protocol_sequence   text,
  delayed             boolean NOT NULL DEFAULT false,
  validation_status   text NOT NULL DEFAULT 'accepted' CHECK (validation_status IN ('accepted', 'rejected', 'duplicate')),
  rejection_reason    text,
  raw_hash            text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gps_positions_source_key ON gps_positions (gps_device_id, source_position_id) WHERE source_position_id IS NOT NULL;
CREATE INDEX gps_positions_bus_measured_idx ON gps_positions (bus_id, measured_at DESC);
CREATE INDEX gps_positions_device_measured_idx ON gps_positions (gps_device_id, measured_at DESC);

CREATE TABLE vehicle_live_states (
  bus_id          uuid PRIMARY KEY REFERENCES buses (id),
  trip_id         uuid REFERENCES trips (id),
  gps_position_id uuid REFERENCES gps_positions (id),
  position        geometry(Point, 4326) NOT NULL,
  measured_at     timestamptz NOT NULL,
  received_at     timestamptz NOT NULL,
  freshness       text NOT NULL CHECK (freshness IN ('live', 'delayed', 'stale', 'offline')),
  speed_mps       double precision,
  heading_deg     double precision,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gps_gateway_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_external_id text,
  source_position_id text,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processing_status  text NOT NULL CHECK (processing_status IN ('accepted', 'rejected', 'duplicate')),
  rejection_reason   text,
  raw_hash           text
);

CREATE TABLE gps_reconciliation_cursors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_external_id text NOT NULL,
  cursor_value      text,
  last_success_at   timestamptz,
  backlog_state     text,
  error_state       text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON gps_positions, vehicle_live_states, gps_gateway_messages, gps_reconciliation_cursors TO busway_app;

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0009 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;