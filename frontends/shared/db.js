/**
 * The app's database, over `/api/db/`.
 *
 * The sibling of `store.js`: that module is for a document an app saves whole,
 * this one is for rows an app queries. As there, an app does not name itself or
 * register a route — the URL comes from `location.pathname`, so this file is
 * the same for every app.
 *
 *     import { db } from "/shared/db.js";
 *
 *     const todos = db();
 *     const { rows } = await todos.run("listTodos");
 *     await todos.run("addTodo", ["milk"]);
 *
 * The SQL is not here. `run` names a query defined in the app's own
 * `queries.sql`, and the server runs that file's version — nothing on this side
 * can send a statement of its own. Parameters fill the `?` placeholders in the
 * named query, in order, and are bound rather than pasted in.
 *
 * Every call resolves to `{ rows, rowsAffected, lastInsertRowid }`: `rows` is
 * always an array, empty for a statement that returns nothing, so a caller can
 * destructure it without checking. Failure throws — an unknown query name, a
 * schema file the app author got wrong, or the database itself refusing — with
 * the server's own message, which names the file and the line where it can.
 */

const ROUTE = "/api/db/";

/** `/apps/meta/main/todo2/index.html` → `meta/main/todo2`. */
function appPath() {
  const segments = decodeURIComponent(location.pathname).split("/").filter(Boolean);
  if (segments[0] !== "apps") return null;
  // A trailing filename is a page, not a folder segment; a bare folder URL has none.
  const rest = segments.slice(1);
  if (rest.at(-1)?.includes(".")) rest.pop();
  return rest.length ? rest.join("/") : null;
}

class DbError extends Error {}

/**
 * A handle on this app's database.
 *
 * `path` is only for pages served from somewhere other than their own app
 * folder; everything under `apps/` should leave it out.
 */
export function db(path = appPath()) {
  if (!path) throw new DbError("Not running inside an app, so there is no database.");
  const url = ROUTE + path;

  return {
    path,

    /** Run the named query from this app's `queries.sql`. */
    async run(query, params = []) {
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, params }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new DbError(body?.error || `Query "${query}" failed (${response.status}).`);
      }
      return body;
    },

    /** The rows alone, for the common case of a `SELECT`. */
    async rows(query, params = []) {
      return (await this.run(query, params)).rows;
    },

    /** The first row, or null — for a lookup by id or a `COUNT`. */
    async row(query, params = []) {
      return (await this.rows(query, params))[0] ?? null;
    },
  };
}
