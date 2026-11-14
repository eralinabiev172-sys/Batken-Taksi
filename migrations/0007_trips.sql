-- Up Migration

CREATE TABLE trips (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id             text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  driver_assignment_id  uuid NOT NULL REFERENCES driver_bus_assignments (id),
  driver_user_id        uuid NOT NULL REFERENCES users (id),
  bus_id                uuid NOT NULL REFERENCES buses (id),
  route_direction_id    uuid REFERENCES route_directions (id),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  started_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX trips_driver_idx ON trips (driver_user_id, started_at);
CREATE INDEX trips_bus_idx ON trips (bus_id, started_at);
CREATE UNIQUE INDEX trips_one_active_per_driver ON trips (driver_user_id) WHERE status = 'active';
CREATE UNIQUE INDEX trips_one_active_per_bus ON trips (bus_id) WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE ON trips TO busway_app;

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0007 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;