-- Up Migration

CREATE TABLE fault_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id   text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  trip_id     uuid REFERENCES trips (id),
  bus_id      uuid REFERENCES buses (id),
  driver_user_id uuid REFERENCES users (id),
  category    text NOT NULL CHECK (btrim(category) <> ''),
  description text NOT NULL CHECK (btrim(description) <> ''),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fault_reports_status_idx ON fault_reports (status);
CREATE INDEX fault_reports_trip_idx ON fault_reports (trip_id);

GRANT SELECT, INSERT, UPDATE ON fault_reports TO busway_app;

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0010 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;