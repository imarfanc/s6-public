/**
 * Project file access, on Val Town and on a real filesystem.
 *
 * Val Town runs vals from a project store rather than a disk: `Deno.readFile`
 * and `Deno.readDir` find nothing there, which is why project files have to go
 * through the `std/utils` helpers. Locally there is no Val Town API to talk to,
 * so the same calls have to use the filesystem. Everything that touches a
 * project file goes through this module so that split lives in one place.
 *
 * Paths here are repository-relative and slash-separated, for example
 * `apps/26.9/todo2/app.yaml`.
 */

/** Local runs import this file from disk; Val Town serves it over https. */
export const ON_VAL_TOWN = !import.meta.url.startsWith("file:");

export const REPO_ROOT = new URL("../../", import.meta.url);

export interface LocalCheckout {
  /** Home-relative when the repo lives under `$HOME`, otherwise absolute. */
  root: string;
  /** Last path segment. Substituted into `frontend.kmtriggerFile` / `kmtriggerFolder`. */
  name: string;
}

/** Rewrite an absolute path as `~/…` when it sits under `$HOME`. */
export function homeRelativePath(absolutePath: string, home: string | undefined): string {
  const root = absolutePath.replace(/\/+$/, "");
  const homeRoot = home?.replace(/\/+$/, "");
  if (homeRoot && (root === homeRoot || root.startsWith(`${homeRoot}/`))) {
    return `~${root.slice(homeRoot.length)}`;
  }
  return root;
}

/**
 * Where this process is running from, for local Mac tools (Keyboard Maestro).
 * Null on Val Town: there is no checkout path a Mac can open.
 */
export function localCheckout(): LocalCheckout | null {
  if (ON_VAL_TOWN) return null;
  const absolute = decodeURIComponent(REPO_ROOT.pathname).replace(/\/+$/, "");
  const name = absolute.split("/").pop();
  if (!name) return null;
  return { root: homeRelativePath(absolute, Deno.env.get("HOME")), name };
}

/**
 * Imported through a variable so that a local `deno check` never tries to
 * resolve it — the helpers only exist on Val Town.
 */
const UTILS = "https://esm.town/v/std/utils@85-main/index.ts";

interface ValTownUtils {
  readFile(path: string, meta: string): Promise<string>;
  listFiles(meta: string): Promise<unknown[]>;
  serveFile(path: string, meta: string): Promise<Response>;
}

let utilsPromise: Promise<ValTownUtils> | null = null;

function utils(): Promise<ValTownUtils> {
  utilsPromise ??= import(UTILS) as Promise<ValTownUtils>;
  return utilsPromise;
}

/** Val Town wants a leading slash; the rest of this repo does not use one. */
function absolute(path: string): string {
  return `/${path.replace(/^\/+/, "")}`;
}

export async function readTextFile(path: string): Promise<string> {
  if (ON_VAL_TOWN) return await (await utils()).readFile(absolute(path), import.meta.url);
  return await Deno.readTextFile(new URL(path, REPO_ROOT));
}

/**
 * Every file in the project, as repository-relative paths.
 *
 * `listFiles` has returned both plain strings and objects across Val Town
 * versions, so both shapes are accepted rather than assumed.
 */
export async function listPaths(): Promise<string[]> {
  if (!ON_VAL_TOWN) return await walk(REPO_ROOT);

  const entries = await (await utils()).listFiles(import.meta.url);
  return entries
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const record = entry as { path?: unknown; name?: unknown };
      return typeof record.path === "string"
        ? record.path
        : typeof record.name === "string"
        ? record.name
        : "";
    })
    .filter(Boolean)
    .map((path) => path.replace(/^\/+/, ""));
}

const SKIP_DIRECTORIES = new Set([".git", ".vt", "node_modules", "_other"]);

async function walk(directory: URL, relative = ""): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isDirectory) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      paths.push(...await walk(new URL(`${entry.name}/`, directory), `${relative}${entry.name}/`));
    } else if (entry.isFile) {
      paths.push(`${relative}${entry.name}`);
    }
  }
  return paths;
}

const CONTENT_TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  excalidraw: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  webp: "image/webp",
  woff2: "font/woff2",
  yaml: "text/yaml; charset=utf-8",
};

function contentType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/** Serve one project file, or null when it does not exist. */
export async function serve(path: string): Promise<Response | null> {
  if (ON_VAL_TOWN) {
    try {
      const response = await (await utils()).serveFile(absolute(path), import.meta.url);
      return response.status === 404 ? null : response;
    } catch {
      return null;
    }
  }

  try {
    const file = await Deno.readFile(new URL(path, REPO_ROOT));
    return new Response(file, { headers: { "content-type": contentType(path) } });
  } catch {
    return null;
  }
}
