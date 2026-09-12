/**
 * The app database, on Val Town and on a real filesystem.
 *
 * The third member of the `files.ts` / `blob.ts` family, and the only module
 * that knows an SQL database exists. Val Town gives a val one SQLite database
 * reached over its own client; locally there is no such service, so the same
 * calls run against a file under `_other/data/<dbPrefix>/`. Everything that touches the
 * database goes through here so that split lives in one place.
 *
 * Callers see one shape — `execute` and `batch`, taking positional `?` params
 * and returning row objects — and never learn which driver answered. The two
 * disagree on almost everything else: Val Town's client returns rows as arrays
 * plus a separate column list, `node:sqlite` returns objects and wants a
 * prepared statement first. Normalising here is what keeps `routes/db.ts` from
 * growing an `ON_VAL_TOWN` branch of its own.
 *
 * Table names never reach this module from a request. `routes/db.ts` resolves
 * every `{token}` in an app's SQL to a namespaced physical name before calling
 * in, so nothing here has to think about which app it is working for.
 */

import { config } from "../../shared/config.ts";
import { ON_VAL_TOWN, REPO_ROOT } from "./files.ts";

/**
 * Imported through a variable so that a local `deno check` never tries to
 * resolve it — this client only exists on Val Town. Same shape as `blob.ts`.
 */
const VAL_TOWN_SQLITE = "https://esm.town/v/std/sqlite/main.ts";

/** Tracked as local seed data. On Val Town there is no file at all. */
const LOCAL_FILE = new URL(config.files.sqlite, REPO_ROOT);

/** One statement and its positional parameters. */
export interface Statement {
  sql: string;
  params?: unknown[];
}

export interface Result {
  rows: Record<string, unknown>[];
  rowsAffected: number;
  /** Null rather than 0 when the statement inserted nothing. */
  lastInsertRowid: number | null;
}

const EMPTY: Result = { rows: [], rowsAffected: 0, lastInsertRowid: null };

interface ValTownResultSet {
  columns: string[];
  rows: unknown[][];
  rowsAffected: number;
  lastInsertRowid?: bigint | number | null;
}

interface ValTownSqlite {
  execute(statement: { sql: string; args: unknown[] }): Promise<ValTownResultSet>;
  batch(statements: { sql: string; args: unknown[] }[]): Promise<ValTownResultSet[]>;
}

/** `node:sqlite`, narrowed to the two methods used here. */
interface LocalDatabase {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
  exec(sql: string): void;
}

let remotePromise: Promise<ValTownSqlite> | null = null;
let localPromise: Promise<LocalDatabase> | null = null;

function remote(): Promise<ValTownSqlite> {
  remotePromise ??= (import(VAL_TOWN_SQLITE) as Promise<{ sqlite: ValTownSqlite }>)
    .then((module) => module.sqlite);
  return remotePromise;
}

async function openLocal(): Promise<LocalDatabase> {
  await Deno.mkdir(new URL(".", LOCAL_FILE), { recursive: true });
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(new URL(LOCAL_FILE).pathname) as unknown as LocalDatabase;
  // WAL keeps the dev server's reads from blocking on its own writes, and is
  // the only pragma worth setting for a single-process development database.
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

function local(): Promise<LocalDatabase> {
  localPromise ??= openLocal();
  return localPromise;
}

/** SQLite hands back bigint for rowids; JSON does not carry them. */
function toNumber(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : null;
}

/**
 * Both drivers report the connection's most recent rowid whatever ran, so an
 * `UPDATE` comes back carrying the id of some earlier `INSERT`. Reporting it
 * only for a statement that could have produced one is the difference between
 * a field a caller can trust and one it has to second-guess.
 */
function insertsRows(sql: string): boolean {
  return /^\s*(?:insert|replace)\b/i.test(sql);
}

function fromValTown(sql: string, result: ValTownResultSet): Result {
  return {
    rows: result.rows.map((row) =>
      Object.fromEntries(result.columns.map((column, index) => [column, row[index] ?? null]))
    ),
    rowsAffected: result.rowsAffected ?? 0,
    lastInsertRowid: insertsRows(sql) ? toNumber(result.lastInsertRowid) : null,
  };
}

/** A statement that returns rows, as opposed to one that only changes them. */
function returnsRows(sql: string): boolean {
  return /^\s*(?:with|select|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);
}

function runLocal(database: LocalDatabase, statement: Statement): Result {
  const prepared = database.prepare(statement.sql);
  const params = statement.params ?? [];
  if (returnsRows(statement.sql)) {
    return { ...EMPTY, rows: prepared.all(...params) };
  }
  const changes = prepared.run(...params);
  return {
    rows: [],
    rowsAffected: Number(changes.changes),
    lastInsertRowid: insertsRows(statement.sql) ? toNumber(changes.lastInsertRowid) : null,
  };
}

export async function execute(sql: string, params: unknown[] = []): Promise<Result> {
  if (ON_VAL_TOWN) return fromValTown(sql, await (await remote()).execute({ sql, args: params }));
  return runLocal(await local(), { sql, params });
}

/**
 * Several statements as one unit.
 *
 * Val Town's client wraps a batch in a transaction, so a failing statement
 * rolls the rest back; the local driver is given the same guarantee by hand.
 * Schema setup relies on it — a half-created set of tables is worse than none.
 */
export async function batch(statements: Statement[]): Promise<Result[]> {
  if (statements.length === 0) return [];

  if (ON_VAL_TOWN) {
    const results = await (await remote())
      .batch(statements.map(({ sql, params }) => ({ sql, args: params ?? [] })));
    return results.map((result, index) => fromValTown(statements[index]!.sql, result));
  }

  const database = await local();
  database.exec("BEGIN");
  try {
    const results = statements.map((statement) => runLocal(database, statement));
    database.exec("COMMIT");
    return results;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
