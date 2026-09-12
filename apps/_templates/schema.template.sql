-- Table definitions for an app with a database. Copy to `web/schema.sql` and
-- set `db: v1` in the app's `app.yaml`.
--
-- `{name}` is a token, not a table name. The server expands it to
-- `<store>_<generation>_<name>` so this app's tables cannot collide with
-- another app's in the one database every app shares. Every table the app uses
-- must be declared here — `queries.sql` may only name tokens that appear in
-- this file. Index names live in the same flat namespace, so name an index
-- after its table's token rather than inventing a bare name.
--
-- Statements run on the app's first request and so must be idempotent. To
-- change a column, bump `db:` to the next generation, edit this
-- file, and copy the rows across in `migrate.sql`.

CREATE TABLE IF NOT EXISTS {items} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS {items}_created ON {items} (created_at DESC);
