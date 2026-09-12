/**
 * The two SQL files an app may keep in `web/` beside its `index.html`, and the token
 * rewriting that keeps one shared database from becoming a namespace free-for-
 * all.
 *
 * This module is pure text: no database, no `apps/` walk, no request. Splitting
 * it out from `routes/db.ts` is what makes the awkward parts — statement
 * splitting, comment stripping, name resolution — testable without a driver,
 * the same reason `shared/app-yaml.ts` sits apart from `routes/apps.ts`.
 *
 * ## Why tokens
 *
 * Val Town gives a val a single SQLite database, so every app's tables share
 * one flat namespace and a name like `todos` is a collision waiting for the
 * second app. An app therefore never writes a real table name. It writes
 * `{todos}`, and this module expands that to
 * `<namespace>_<generation>_todos`.
 *
 * A single underscore joins the three parts, which is short to type in a
 * database browser at the cost of being ambiguous in theory — a `store:` of
 * `todo2_v1` would produce the same name as `todo2` in generation `v1`. Both
 * apps would have to exist, with the same table name, for that to matter.
 *
 * The namespace is the app's `store:`, the same field `/api/data/` uses, so a
 * folder rename does not orphan a database any more than it orphans a blob.
 * The generation is the `db:` field's value — `v1`, `v2` — which is how a
 * schema change that SQLite cannot `ALTER` into place is made: bump the
 * generation, get an empty set of tables, and copy the old rows across in
 * `migrate.sql`, where `{prev.todos}` names the previous generation's table.
 *
 * Because expansion is a lookup over declared names and not SQL parsing, a
 * typo'd `{todso}` is an error at load rather than a query against a table
 * nobody made.
 *
 * ## The subset
 *
 * Statements are split on semicolons after `--` comments are stripped, which
 * means a semicolon inside a string literal or a `CREATE TRIGGER` body will
 * split in the wrong place. Both are out of scope, in the spirit of
 * `app-yaml.ts`: the day an app needs a trigger is the day this grows a real
 * splitter, and until then a full SQL parser is a dependency bought for
 * nothing.
 */

import { config } from "./config.ts";

/** `db: v1`. Anything else in `app.yaml` means the app has no database. */
export const GENERATION = /^v[1-9][0-9]*$/;

/** Table tokens and query names share the shape of a plain identifier. */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/i;

const TOKEN = /\{\s*(prev\.)?([a-z][a-z0-9_]*)\s*\}/gi;

const QUERY_NAME = /^\s*--\s*name:\s*([A-Za-z][A-Za-z0-9_]*)\s*$/;

/** Bookkeeping for `migrate.sql`, shared by every app in the database. */
export const MIGRATIONS_TABLE = `${config.dbPrefix}_migrations`;

export class SqlError extends Error {}

/**
 * An app's `store:` reduced to something safe to paste into a table name.
 *
 * Table names are not parameterisable in SQLite, so the only defence against a
 * hostile one is that it never contains anything but word characters. Anything
 * else collapses to `_`; an empty result is rejected by the caller.
 */
export function namespace(store: string): string {
  return store.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** `todos` in generation `v2` of `todo2` → `todo2_v2_todos`. */
export function tableName(store: string, generation: string, table: string): string {
  return `${namespace(store)}_${generation}_${table}`;
}

/** The generation before `v3` is `v2`; `v1` has none. */
export function previousGeneration(generation: string): string | null {
  const version = Number(generation.slice(1));
  return version > 1 ? `v${version - 1}` : null;
}

/** Drop `--` comments so they cannot hide a semicolon or a token. */
function strip(sql: string): string {
  return sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
}

/** Non-empty statements, in file order, without their trailing semicolons. */
export function statements(sql: string): string[] {
  return strip(sql).split(";").map((part) => part.trim()).filter(Boolean);
}

/** Every distinct `{table}` token in `sql`, ignoring `{prev.table}`. */
export function declaredTables(sql: string): string[] {
  const names = new Set<string>();
  for (const [, previous, name] of strip(sql).matchAll(TOKEN)) {
    if (!previous) names.add(name!);
  }
  return [...names].sort();
}

/**
 * Replace every `{table}` with its physical name.
 *
 * `known` is the set declared by `schema.sql`, so a query naming a table the
 * app never creates fails here rather than at the database. `prev.` is only
 * resolvable when a previous generation exists, and only in `migrate.sql`,
 * which the caller enforces by passing `allowPrevious`.
 */
export function expand(
  sql: string,
  options: {
    store: string;
    generation: string;
    known: Set<string>;
    allowPrevious?: boolean;
    where: string;
  },
): string {
  return sql.replace(TOKEN, (_match, previous: string | undefined, name: string) => {
    if (!options.known.has(name)) {
      throw new SqlError(`${options.where}: {${name}} is not a table declared in schema.sql.`);
    }
    if (!previous) return tableName(options.store, options.generation, name);

    if (!options.allowPrevious) {
      throw new SqlError(`${options.where}: {prev.${name}} is only allowed in migrate.sql.`);
    }
    const earlier = previousGeneration(options.generation);
    if (!earlier) {
      throw new SqlError(`${options.where}: generation v1 has no previous generation.`);
    }
    return tableName(options.store, earlier, name);
  });
}

/**
 * The named blocks of a `queries.sql`.
 *
 * ```sql
 * -- name: listTodos
 * SELECT id, text, done FROM {todos} ORDER BY id DESC;
 * ```
 *
 * A block runs as exactly one statement — the point of the file is that a
 * request names a query rather than sending SQL, and a name that can expand to
 * three statements gives that away again. Anything before the first `-- name:`
 * is a file header and is ignored.
 */
export function queries(sql: string): Map<string, string> {
  const blocks = new Map<string, string[]>();
  let current: string[] | null = null;

  for (const line of sql.split("\n")) {
    const header = line.match(QUERY_NAME);
    if (header) {
      const name = header[1]!;
      if (blocks.has(name)) throw new SqlError(`queries.sql: duplicate query "${name}".`);
      current = [];
      blocks.set(name, current);
      continue;
    }
    current?.push(line);
  }

  const parsed = new Map<string, string>();
  for (const [name, lines] of blocks) {
    const body = statements(lines.join("\n"));
    if (body.length === 0) throw new SqlError(`queries.sql: query "${name}" is empty.`);
    if (body.length > 1) {
      throw new SqlError(`queries.sql: query "${name}" holds more than one statement.`);
    }
    parsed.set(name, body[0]!);
  }
  return parsed;
}

/** Guards the two identifiers that arrive from a request or a marker file. */
export function isIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}
