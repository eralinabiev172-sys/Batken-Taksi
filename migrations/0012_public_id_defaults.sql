-- Up Migration

-- Migrations 0005-0010 declared public_id NOT NULL without a default, and the API inserts
-- rows without it, so every create endpoint failed on a real database. Generate the opaque
-- public id in the database: "<prefix>_<22 chars of [A-Za-z0-9_-]>" (matches the CHECK
-- constraints). Existing rows and constraints are not changed.
CREATE FUNCTION busway_new_public_id(prefix text) RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT prefix || '_' || substr(
    translate(
      encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'base64'),
      '+/=', '-_'
    ), 1, 22)
$$;

ALTER TABLE buses                     ALTER COLUMN public_id SET DEFAULT busway_new_public_id('bus');
ALTER TABLE routes                    ALTER COLUMN public_id SET DEFAULT busway_new_public_id('route');
ALTER TABLE route_directions          ALTER COLUMN public_id SET DEFAULT busway_new_public_id('rdir');
ALTER TABLE stops                     ALTER COLUMN public_id SET DEFAULT busway_new_public_id('stop');
ALTER TABLE driver_bus_assignments    ALTER COLUMN public_id SET DEFAULT busway_new_public_id('asg');
ALTER TABLE gps_devices               ALTER COLUMN public_id SET DEFAULT busway_new_public_id('dev');
ALTER TABLE trips                     ALTER COLUMN public_id SET DEFAULT busway_new_public_id('trip');
ALTER TABLE public_visibility_grants  ALTER COLUMN public_id SET DEFAULT busway_new_public_id('grant');
ALTER TABLE fault_reports             ALTER COLUMN public_id SET DEFAULT busway_new_public_id('fault');

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0012 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;
