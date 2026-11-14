#!/bin/sh
# BusWay KG: first-start initialisation of the local development database cluster.
# Runs once, only when the data volume is empty (docker-entrypoint-initdb.d).
# Passwords come from the container environment; psql variables quote them safely.
set -eu

: "${BUSWAY_MIGRATOR_PASSWORD:?BUSWAY_MIGRATOR_PASSWORD is required}"
: "${BUSWAY_APP_PASSWORD:?BUSWAY_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v mp="$BUSWAY_MIGRATOR_PASSWORD" -v ap="$BUSWAY_APP_PASSWORD" <<'SQL'
-- busway_migrator owns schema objects (DDL); busway_app only reads/writes data.
CREATE ROLE busway_migrator LOGIN PASSWORD :'mp' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE busway_app      LOGIN PASSWORD :'ap' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Scratch database for automated tests; never used by the application.
CREATE DATABASE busway_test;

\connect busway
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
REVOKE ALL ON DATABASE busway FROM PUBLIC;
GRANT CONNECT ON DATABASE busway TO busway_migrator, busway_app;
GRANT CREATE, USAGE ON SCHEMA public TO busway_migrator;
GRANT USAGE ON SCHEMA public TO busway_app;

\connect busway_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
REVOKE ALL ON DATABASE busway_test FROM PUBLIC;
GRANT CONNECT ON DATABASE busway_test TO busway_migrator, busway_app;
GRANT CREATE, USAGE ON SCHEMA public TO busway_migrator;
GRANT USAGE ON SCHEMA public TO busway_app;
SQL
