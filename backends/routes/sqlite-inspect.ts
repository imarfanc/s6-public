/**
 * Read-only catalog of the shared app database: `GET /api/sqlite`.
 *
 * This is not a SQL console and it is not a second `/api/db/` with a
 * passthrough. The browser still never sends a statement. It asks for the list
 * of tables, or for a page of rows from one table whose name is already in
 * `sqlite_master` and matches a plain identifier. Writes, `PRAGMA`, and
 * anything that is not `SELECT` stay unreachable.
 *
 * Table names cannot be bound, so the one interpolation here is that validated
 * identifier, quoted, after a lookup that proves the table exists. That is the
 * same reason `{tokens}` exist on the app route — the name never comes from a
 * string the client invented and we then pasted.
 *
 * Auth is already settled before any handler runs. `/api/sqlite` is assigned
 * to the sqlite inspector's appspace, so a public gallery cannot read tables
 * that live behind a locked appspace.
 */

import { GENERATION, isIdentifier, MIGRATIONS_TABLE, namespace } from "../../shared/app-sql.ts";
import { execute } from "../shared/sqlite.ts";
import { type App, discover } from "./apps.ts";
import { ensureDeclaredTables } from "./db.ts";
import { json, methodNotAllowed, restOf } from "../shared/http.ts";

const ROUTE = "/api/sqlite";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** Quote a name that `isIdentifier` has already accepted. */
function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

interface Owner {
  path: string;
  name: string;
  store: string;
  db: string;
  token: string;
}

function ownerOf(physical: string, apps: App[]): Owner | null {
  for (const app of apps) {
    if (!GENERATION.test(app.db)) continue;
    const store = app.store || app.id;
    const prefix = `${namespace(store)}_${app.db}_`;
    if (!physical.startsWith(prefix)) continue;
    return {
      path: app.path,
      name: app.name,
      store,
      db: app.db,
      token: physical.slice(prefix.length),
    };
  }
  return null;
}

async function tableExists(name: string): Promise<boolean> {
  const found = await execute(
    `SELECT 1 AS ok FROM sqlite_master
     WHERE type IN ('table', 'view') AND name = ? AND name NOT LIKE 'sqlite_%'`,
    [name],
  );
  return found.rows.length > 0;
}

async function listTables(): Promise<Response> {
  await ensureDeclaredTables();
  const catalog = await execute(
    `SELECT name, type, sql FROM sqlite_master
     WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
     ORDER BY name COLLATE NOCASE`,
  );
  const { apps } = await discover();
  const tables: {
    name: string;
    type: string;
    sql: string | null;
    rows: number;
    bookkeeping: boolean;
    app: Owner | null;
  }[] = [];
  for (const row of catalog.rows) {
    const name = String(row.name);
    const quoted = quoteIdent(name);
    const count = await execute(`SELECT COUNT(*) AS n FROM ${quoted}`);
    tables.push({
      name,
      type: String(row.type ?? "table"),
      sql: row.sql == null ? null : String(row.sql),
      rows: Number(count.rows[0]?.n ?? 0),
      bookkeeping: name === MIGRATIONS_TABLE,
      app: ownerOf(name, apps),
    });
  }
  return json({ tables });
}

async function showTable(name: string, search: URLSearchParams): Promise<Response> {
  if (!isIdentifier(name) || !(await tableExists(name))) {
    return json({ error: "No such table." }, 404);
  }

  const limit = clampInt(search.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(search.get("offset"), 0, 0, 1_000_000_000);
  const quoted = quoteIdent(name);
  const info = await execute(`PRAGMA table_info(${name})`);
  const counted = await execute(`SELECT COUNT(*) AS n FROM ${quoted}`);
  const page = await execute(`SELECT * FROM ${quoted} LIMIT ? OFFSET ?`, [limit, offset]);
  const { apps } = await discover();

  return json({
    name,
    type: "table",
    app: ownerOf(name, apps),
    columns: info.rows.map((col) => ({
      name: col.name,
      type: col.type,
      notnull: col.notnull === 1,
      pk: Number(col.pk) > 0,
      dflt_value: col.dflt_value ?? null,
    })),
    rows: page.rows,
    total: Number(counted.rows[0]?.n ?? 0),
    limit,
    offset,
  });
}

export async function handleSqliteInspect(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname !== ROUTE && !pathname.startsWith(`${ROUTE}/`)) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }

  const decoded = restOf(pathname, ROUTE);
  if (decoded === null) return json({ error: "No such table." }, 404);
  const rest = decoded.replace(/^\//, "");
  if (!rest) return await listTables();
  if (rest.includes("/")) return json({ error: "No such table." }, 404);
  return await showTable(rest, url.searchParams);
}
