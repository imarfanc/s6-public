/**
 * App storage over HTTP: `GET|PUT|DELETE /api/data/<app path>/<key>`.
 *
 * One route for every app, rather than one route per app. sites4 hand-wrote a
 * handler, a set of blob keys, and a validator for each app that needed to save
 * something; ten apps that way is ten handlers to keep in step. Here an app
 * saves by calling `/api/data/<its own folder>/<key>` and there is nothing to
 * register — `/shared/store.js` derives that URL from `location.pathname`
 * so an app does not even name itself.
 *
 * What is stored is text, and the key's extension says which kind: `scene.csv`
 * comes back as CSV, `notes.md` as Markdown, an extensionless key as JSON. The
 * only thing checked is that the value parses as what it claims to be — a
 * truncated write should fail here rather than surface as a broken app later.
 * What the value *means* is the app's business, which is what keeps this file
 * from growing a branch per app.
 *
 * The parsers are real ones from `@std`, not `shared/app-yaml.ts`. That module
 * reads a deliberately tiny YAML subset because `app.yaml` is written by hand
 * and stays small; this route validates whatever an app sends, where a subset
 * would reject valid documents.
 *
 * They come from pinned `esm.sh` URLs loaded through a variable, the same shape
 * `files.ts` and `blob.ts` use, and the form `_other/docs/vt.md` asks for. A
 * bare `@std/yaml` does not work here: Val Town serves project files from
 * `esm.town` over https and does not apply `deno.json`'s import map to them, so
 * it resolves locally and fails in production. An inline `https:` specifier
 * resolves in both, but `deno lint`'s `no-import-prefix` rejects it — hence the
 * variable, which also keeps `deno check` off a URL it need not fetch.
 *
 * Auth is already settled before any handler runs: `routes/router.ts` rejects
 * locked-appspace requests without a grant, so writes sit behind that
 * appspace's `password_env` without this module doing anything about it.
 */

import { read, remove, write } from "../shared/blob.ts";
import { errorMessage, json, methodNotAllowed, restOf } from "../shared/http.ts";
import { discover } from "./apps.ts";

const ROUTE = "/api/data/";

/** Pinned esm.sh URLs, imported through variables. See the note above. */
const CSV = "https://esm.sh/jsr/@std/csv@1.0.6";
const YAML = "https://esm.sh/jsr/@std/yaml@1.0.9";

type Parse = (value: string, options?: Record<string, unknown>) => unknown;

let parsersPromise: Promise<{ csv: Parse; yaml: Parse }> | null = null;

/** Loaded once, on the first write that needs one; reads never pay for this. */
function parsers(): Promise<{ csv: Parse; yaml: Parse }> {
  parsersPromise ??= Promise.all([
    import(CSV) as Promise<{ parse: Parse }>,
    import(YAML) as Promise<{ parse: Parse }>,
  ]).then(([csv, yaml]) => ({ csv: csv.parse, yaml: yaml.parse }));
  return parsersPromise;
}

/** Roughly Val Town's own per-blob ceiling, and far above any sane scene. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Both halves of a storage key. Deliberately narrow: no slashes, so a key can
 * never climb out of its namespace, and no characters that need escaping in a
 * filename on the local path or in a blob key on Val Town.
 */
const SAFE = /^[A-Za-z0-9._-]+$/;

/**
 * What each extension is served as, and which parser has to accept it. A key
 * with no extension, or an unlisted one, is treated as JSON — `store.js` writes
 * JSON under bare keys like `scene`. `check: null` means any text will do.
 */
const FORMATS: Record<string, { type: string; check: "csv" | "json" | "yaml" | null }> = {
  csv: { type: "text/csv; charset=utf-8", check: "csv" },
  json: { type: "application/json; charset=utf-8", check: "json" },
  md: { type: "text/markdown; charset=utf-8", check: null },
  txt: { type: "text/plain; charset=utf-8", check: null },
  yaml: { type: "text/yaml; charset=utf-8", check: "yaml" },
  yml: { type: "text/yaml; charset=utf-8", check: "yaml" },
};

/** Throws with the parser's own message when `value` is not valid `kind`. */
async function validate(kind: "csv" | "json" | "yaml" | null, value: string): Promise<void> {
  if (kind === null) return;
  if (kind === "json") {
    JSON.parse(value);
    return;
  }
  const parse = await parsers();
  // fieldsPerRecord: 0 takes the column count from the first row and holds the
  // rest to it; without it a ragged row parses happily.
  if (kind === "csv") parse.csv(value, { fieldsPerRecord: 0 });
  else parse.yaml(value);
}

const DEFAULT_FORMAT = FORMATS.json!;

/** `notes.md` → Markdown; `scene` → JSON. */
function format(name: string) {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return FORMATS[extension] ?? DEFAULT_FORMAT;
}

const encoder = new TextEncoder();

/**
 * Resolve `<app path>/<key>` from the URL into a blob key.
 *
 * The namespace is the app's `store:` rather than its folder, so renaming or
 * moving a folder keeps the data — unlike the app's id, which is derived from
 * the path and does break on a rename. An app that declares no `store:` falls
 * back to its slugged folder path, which does not survive a rename; that is the
 * cost of leaving the field out, and it is why the template sets it.
 */
async function resolve(
  pathname: string,
): Promise<{ key: string; format: ReturnType<typeof format> } | null> {
  const rest = restOf(pathname, ROUTE);
  if (rest === null) return null;

  const segments = rest.split("/").filter(Boolean);
  const name = segments.pop();
  const path = segments.join("/");
  if (!name || !path || !SAFE.test(name)) return null;

  const app = (await discover()).apps.find((candidate) => candidate.path === path);
  if (!app) return null;

  const namespace = app.store || app.id;
  return SAFE.test(namespace) ? { key: `${namespace}/${name}`, format: format(name) } : null;
}

export async function handleData(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(ROUTE)) return null;

  const target = await resolve(pathname);
  if (!target) return json({ error: "No such app or key." }, 404);

  if (request.method === "GET" || request.method === "HEAD") {
    const value = await read(target.key);
    if (value === null) return json({ error: "Nothing stored under that key." }, 404);
    return new Response(value, {
      headers: { "content-type": target.format.type, "cache-control": "no-store" },
    });
  }

  if (request.method === "PUT") {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
      return json({ error: "Value is too large." }, 413);
    }
    const value = await request.text();
    if (encoder.encode(value).byteLength > MAX_BYTES) {
      return json({ error: "Value is too large." }, 413);
    }
    try {
      await validate(target.format.check, value);
    } catch (error) {
      // The parser's own message names the line, which is worth passing on.
      const detail = errorMessage(error);
      return json({ error: `Value did not parse: ${detail}` }, 400);
    }
    await write(target.key, value);
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    await remove(target.key);
    return json({ ok: true });
  }

  return methodNotAllowed("GET, HEAD, PUT, DELETE");
}
