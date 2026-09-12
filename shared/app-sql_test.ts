import { assertEquals, assertThrows } from "@std/assert";
import {
  declaredTables,
  expand,
  namespace,
  previousGeneration,
  queries,
  SqlError,
  statements,
  tableName,
} from "./app-sql.ts";

const SCHEMA = `
-- a comment with a ; semicolon and a {fake} token
CREATE TABLE IF NOT EXISTS {todos} (id INTEGER PRIMARY KEY);
CREATE INDEX IF NOT EXISTS {todos}_done ON {todos} (done);
CREATE TABLE IF NOT EXISTS {tags} (id INTEGER PRIMARY KEY);
`;

const known = new Set(["todos", "tags"]);
const options = { store: "todo2", generation: "v2", known, where: "queries.sql" };

Deno.test("namespace keeps table names to word characters", () => {
  assertEquals(namespace("My App/2!"), "my_app_2");
  assertEquals(tableName("My App", "v1", "todos"), "my_app_v1_todos");
});

Deno.test("declaredTables ignores comments and prev tokens", () => {
  assertEquals(declaredTables(SCHEMA), ["tags", "todos"]);
  assertEquals(declaredTables("SELECT * FROM {prev.todos}"), []);
});

Deno.test("statements splits on semicolons after stripping comments", () => {
  assertEquals(statements(SCHEMA).length, 3);
  assertEquals(statements("-- only a comment;\n"), []);
});

Deno.test("expand rewrites known tokens and rejects unknown ones", () => {
  assertEquals(
    expand("SELECT * FROM {todos}", options),
    "SELECT * FROM todo2_v2_todos",
  );
  assertThrows(() => expand("SELECT * FROM {nope}", options), SqlError);
});

Deno.test("prev tokens need migrate.sql and a previous generation", () => {
  assertThrows(() => expand("SELECT * FROM {prev.todos}", options), SqlError);
  assertEquals(
    expand("SELECT * FROM {prev.todos}", { ...options, allowPrevious: true }),
    "SELECT * FROM todo2_v1_todos",
  );
  assertThrows(
    () =>
      expand("SELECT * FROM {prev.todos}", {
        ...options,
        generation: "v1",
        allowPrevious: true,
      }),
    SqlError,
  );
  assertEquals(previousGeneration("v1"), null);
  assertEquals(previousGeneration("v10"), "v9");
});

Deno.test("queries reads named single-statement blocks", () => {
  const parsed = queries(`
-- a header before the first name is ignored
-- name: listTodos
SELECT id FROM {todos} ORDER BY id;

-- name: addTodo
INSERT INTO {todos} (text) VALUES (?);
`);
  assertEquals([...parsed.keys()], ["listTodos", "addTodo"]);
  assertEquals(parsed.get("listTodos"), "SELECT id FROM {todos} ORDER BY id");
});

Deno.test("queries rejects duplicate, empty and multi-statement blocks", () => {
  assertThrows(() => queries("-- name: a\nSELECT 1;\n-- name: a\nSELECT 2;"), SqlError);
  assertThrows(() => queries("-- name: a\n\n-- name: b\nSELECT 1;"), SqlError);
  assertThrows(() => queries("-- name: a\nSELECT 1; DELETE FROM {todos};"), SqlError);
});
