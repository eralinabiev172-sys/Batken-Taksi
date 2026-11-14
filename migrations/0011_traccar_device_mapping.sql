-- Up Migration

-- Trusted server-side mapping from Traccar's numeric deviceId to a BusWay GPS device.
-- Traccar deviceId is NOT an identity proof; it is only a lookup key after admin registration.
ALTER TABLE gps_devices
  ADD COLUMN traccar_device_id bigint UNIQUE;

GRANT SELECT, INSERT, UPDATE ON gps_devices TO busway_app;

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0011 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;