-- Up Migration

-- DATABASE.md section 3 lists these fields but does not prescribe requiredness,
-- defaults, length limits or uniqueness. Nullable text adds storage without
-- inventing those rules or rewriting existing records. Existing values stay NULL.
ALTER TABLE users
  ADD COLUMN display_name text;

ALTER TABLE driver_profiles
  ADD COLUMN internal_number text,
  ADD COLUMN phone text,
  ADD COLUMN admin_note text;

ALTER TABLE cities
  ADD COLUMN country_code text;

-- No backfill: do not fabricate names/numbers/country codes from existing data.
-- Keep full_name, is_active, request_id and occurred_at unchanged.
-- Deferred for owner clarification: driver status/is_active mapping, city bounds,
-- audit IP/user agent/result, safe before/after and correlation/time field mapping.
-- No audit writes, privilege changes, trigger changes or authentication logic.

-- Down Migration

-- Dropping the added columns would destroy any values entered after this migration.
-- No field deletion is authorised: rollback requires a separately approved plan.
DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0002 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;
