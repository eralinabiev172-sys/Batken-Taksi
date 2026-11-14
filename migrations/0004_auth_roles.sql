-- Up Migration

-- Admin permission grants (D-108). Granular, revocable, auditable.
-- Passenger is intentionally NOT a role: the public map requires no registration (API.md).
CREATE TABLE admin_permissions (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  permission  text NOT NULL CHECK (permission IN (
    'fleet.manage', 'routes.manage', 'assignments.manage', 'trips.view',
    'devices.manage', 'grants.view', 'audit.view', 'admin.manage'
  )),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES users (id),
  PRIMARY KEY (user_id, permission)
);
CREATE INDEX admin_permissions_user_idx ON admin_permissions (user_id);

-- Nullable MFA fields for administrators (D-111). TOTP is mandatory before production;
-- in development MFA is optional and these stay NULL.
ALTER TABLE users
  ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_secret_encrypted text;

-- Least privilege.
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_permissions TO busway_app;

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0004 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;