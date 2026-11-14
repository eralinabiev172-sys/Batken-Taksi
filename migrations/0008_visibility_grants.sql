-- Up Migration

CREATE TABLE public_visibility_grants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id            text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z]{2,8}_[A-Za-z0-9_-]{22}$'),
  driver_assignment_id uuid NOT NULL REFERENCES driver_bus_assignments (id),
  driver_user_id       uuid NOT NULL REFERENCES users (id),
  bus_id               uuid NOT NULL REFERENCES buses (id),
  enabled_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  disabled_at          timestamptz,
  disabled_reason      text CHECK (disabled_reason IS NULL OR disabled_reason IN ('manual', 'expired', 'admin', 'assignment_revoked')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > enabled_at)
);
CREATE INDEX pvg_bus_idx ON public_visibility_grants (bus_id, expires_at);
CREATE INDEX pvg_driver_idx ON public_visibility_grants (driver_user_id, expires_at);
CREATE UNIQUE INDEX pvg_one_active_per_bus ON public_visibility_grants (bus_id) WHERE (disabled_at IS NULL);
CREATE UNIQUE INDEX pvg_one_active_per_assignment ON public_visibility_grants (driver_assignment_id) WHERE (disabled_at IS NULL);

GRANT SELECT, INSERT, UPDATE ON public_visibility_grants TO busway_app;

-- Down Migration

DO $$
BEGIN
  RAISE EXCEPTION 'Automatic rollback of 0008 is disabled; a separate data-preserving plan must be approved'
    USING ERRCODE = '0A000';
END;
$$;