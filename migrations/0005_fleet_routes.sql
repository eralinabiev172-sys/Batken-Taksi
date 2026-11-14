-- Up Migration

-- Fleet & routes for Stage 3.2.2 (D-125: Batken region, route 1 Karа-Bulak <-> Batken).
-- All timestamps UTC (D-107). No physical deletes: archive via archived_at.

CREATE TABLE buses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  city_id        uuid NOT NULL REFERENCES cities (id),
  internal_number text NOT NULL CHECK (btrim(internal_number) <> ''),
  plate_number   text,
  make           text,
  model          text,
  capacity       integer CHECK (capacity IS NULL OR capacity > 0),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'retired', 'archived')),
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX buses_city_idx ON buses (city_id);
CREATE INDEX buses_status_idx ON buses (status) WHERE archived_at IS NULL;

CREATE TABLE routes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  city_id        uuid NOT NULL REFERENCES cities (id),
  public_number  text NOT NULL CHECK (btrim(public_number) <> ''),
  name_ru        text NOT NULL CHECK (btrim(name_ru) <> ''),
  name_ky        text NOT NULL CHECK (btrim(name_ky) <> ''),
  color          text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX routes_city_idx ON routes (city_id);
CREATE UNIQUE INDEX routes_city_number_key ON routes (city_id, public_number) WHERE archived_at IS NULL;

CREATE TABLE route_directions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  route_id       uuid NOT NULL REFERENCES routes (id),
  name_ru        text NOT NULL CHECK (btrim(name_ru) <> ''),
  name_ky        text NOT NULL CHECK (btrim(name_ky) <> ''),
  headsign_ru    text,
  headsign_ky    text,
  geometry       geometry(LineString, 4326),
  geometry_status text NOT NULL DEFAULT 'pending' CHECK (geometry_status IN ('pending', 'approved', 'rejected')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX route_directions_route_idx ON route_directions (route_id);

CREATE TABLE stops (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  city_id        uuid NOT NULL REFERENCES cities (id),
  name_ru        text NOT NULL CHECK (btrim(name_ru) <> ''),
  name_ky        text NOT NULL CHECK (btrim(name_ky) <> ''),
  code           text,
  location       geography(Point, 4326) NOT NULL,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stops_city_idx ON stops (city_id);
CREATE INDEX stops_location_idx ON stops USING gist (location);

CREATE TABLE route_stops (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id   uuid NOT NULL REFERENCES route_directions (id),
  stop_id        uuid NOT NULL REFERENCES stops (id),
  sequence       integer NOT NULL CHECK (sequence > 0),
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (direction_id, sequence)
);
CREATE INDEX route_stops_direction_idx ON route_stops (direction_id);
CREATE INDEX route_stops_stop_idx ON route_stops (stop_id);

-- Least privilege.
GRANT SELECT, INSERT, UPDATE ON buses, routes, route_directions, stops, route_stops TO busway_app;

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0005 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;