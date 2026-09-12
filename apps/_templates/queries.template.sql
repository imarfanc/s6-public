-- Every query the app can run. Copy to `web/queries.sql`.
--
-- The browser sends a name from this file plus its parameters, never SQL. One
-- statement per name; `?` placeholders are filled from the `params` array in
-- order and are bound, not pasted, so a value can never become syntax.

-- name: listItems
SELECT id, name FROM {items} ORDER BY created_at DESC;

-- name: addItem
INSERT INTO {items} (name) VALUES (?);

-- name: deleteItem
DELETE FROM {items} WHERE id = ?;
