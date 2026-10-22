-- Runs automatically the first time the Postgres container starts with an empty
-- data volume (mounted into /docker-entrypoint-initdb.d in docker-compose.yml).
-- Changes here are NOT applied to an existing database.

CREATE TABLE IF NOT EXISTS drops (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    location    TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    quantity    INTEGER NOT NULL CONSTRAINT drops_quantity_check CHECK (quantity >= 0),
    ends_at     TIMESTAMPTZ NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
