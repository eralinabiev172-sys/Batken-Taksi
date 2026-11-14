-- Up Migration

-- M1.3/M1.4: forward-only schema completion. Run in one transaction, without
-- concurrent application writes. 0001 and 0002 are intentionally unchanged.
ALTER TABLE driver_profiles
  ADD COLUMN status text NOT NULL DEFAULT 'pending',
  ALTER COLUMN is_active SET DEFAULT false;

-- Neither legacy boolean value proves administrative approval or suspension.
-- Preserve every other field, including updated_at; do not touch users/sessions.
UPDATE driver_profiles SET is_active = false;

ALTER TABLE driver_profiles
  ADD CONSTRAINT driver_profiles_status_check
    CHECK (status IN ('pending', 'active', 'suspended')),
  ADD CONSTRAINT driver_profiles_active_matches_status
    CHECK (is_active = (status = 'active'));

CREATE FUNCTION driver_profiles_sync_active() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'is_active is derived from status and cannot be changed independently'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.is_active := (NEW.status = 'active');
  RETURN NEW;
END;
$$;

CREATE TRIGGER driver_profiles_derive_active
  BEFORE INSERT OR UPDATE ON driver_profiles
  FOR EACH ROW EXECUTE FUNCTION driver_profiles_sync_active();

ALTER TABLE cities
  ADD COLUMN bounds geometry(Polygon,4326),
  ADD CONSTRAINT cities_bounds_check CHECK (
    bounds IS NULL OR (
      ST_IsValid(bounds) AND NOT ST_IsEmpty(bounds) AND ST_NDims(bounds) = 2
      AND ST_XMin(Box3D(bounds)) >= -180 AND ST_XMax(Box3D(bounds)) <= 180
      AND ST_YMin(Box3D(bounds)) >= -90 AND ST_YMax(Box3D(bounds)) <= 90
    )
  ),
  ADD CONSTRAINT cities_country_code_iso_alpha2 CHECK (
    country_code IS NULL OR country_code IN (
      -- ISO 3166-1 alpha-2 snapshot, checked 2026-11-14 (249 assigned codes).
      -- https://salsa.debian.org/iso-codes-team/iso-codes/-/blob/d055275324963c9bce5882eaaa93024cf2bf7ed0/data/iso_3166-1.json
      -- Cross-check: pycountry iso3166-1.json (249); UN M49 ISO-alpha2 column (248).
      -- Reserved/user-assigned codes are deliberately not accepted. No backfill.
      'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
      'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
      'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
      'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR',
      'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
      'HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
      'JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
      'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
      'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM',
      'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW',
      'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
      'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
      'UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
    )
  );

-- Add without defaults first: historic audit events must retain unknown values.
-- Do not UPDATE audit rows, disable immutability triggers or copy details.
ALTER TABLE audit_logs
  ADD COLUMN ip inet,
  ADD COLUMN user_agent text,
  ADD COLUMN result text,
  ADD COLUMN before_data jsonb,
  ADD COLUMN after_data jsonb,
  ADD COLUMN correlation_id text,
  ADD COLUMN created_at timestamptz,
  ADD CONSTRAINT audit_logs_host_ip_check CHECK (
    ip IS NULL OR masklen(ip) = CASE family(ip) WHEN 4 THEN 32 WHEN 6 THEN 128 END
  ),
  ADD CONSTRAINT audit_logs_result_check CHECK (
    result IS NULL OR result IN ('success', 'failure', 'denied')
  ),
  -- Empty allowlist until event-specific schemas receive separate approval.
  -- Equality to {} excludes arrays, scalars, JSON null and all nested/keyed data.
  ADD CONSTRAINT audit_logs_before_safe_check CHECK (
    before_data IS NULL OR (jsonb_typeof(before_data) = 'object' AND before_data = '{}'::jsonb)
  ),
  ADD CONSTRAINT audit_logs_after_safe_check CHECK (
    after_data IS NULL OR (jsonb_typeof(after_data) = 'object' AND after_data = '{}'::jsonb)
  );

ALTER TABLE audit_logs ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- Record insertion time on the server even if a caller supplies a value/NULL.
-- occurred_at remains the event time, request_id the individual request id.
CREATE FUNCTION audit_logs_set_created_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_logs_record_created_at
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_set_created_at();

-- No session revocation, role/assignment changes, GPS rules or retention job.
-- Existing audit UPDATE/DELETE/TRUNCATE protections and privileges remain intact.

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0003 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;
