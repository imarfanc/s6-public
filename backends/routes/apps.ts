/**
 * App discovery.
 *
 * Walks `apps/` for `app.yaml` markers, folds them into the appspace/section
 * tree described by `apps/sections-metadata.yaml`, and serves the whole thing as
 * one JSON document. The same walk generates the committed production manifest;
 * locally the folders remain authoritative.
 */

import { config } from "../../shared/config.ts";
import { list, listOfMaps, scalars } from "../../shared/app-yaml.ts";
import {
  listPaths,
  type LocalCheckout,
  localCheckout,
  ON_VAL_TOWN,
  readTextFile,
} from "../shared/files.ts";
import { errorMessage, json, methodNotAllowed, readOptional } from "../shared/http.ts";

const APPS_ROOT = `${config.dirs.apps}/`;
const MARKER = config.files.appYaml;
/** Hand-edited appspace and section presentation. */
export const METADATA_FILE = config.files.metadata;
/** The generated production tree, committed beside the folders it describes. */
export const MANIFEST_FILE = config.files.manifest;
/** The file that must import every declared app backend. */
export const ROUTER_FILE = config.files.router;

export interface App {
  id: string;
  name: string;
  sort_name: string;
  description: string;
  updated: string;
  icon: string;
  color: string;
  appspace: string;
  sections: string[];
  tags: string[];
  path: string;
  url: string;
  /**
   * Namespace for this app's `/api/data/` storage. Independent of the folder
   * path on purpose: `id:` is the deep link and should outlive a rename, and
   * saved data should too. Empty when `app.yaml` leaves `store:` out.
   */
  store: string;
  /**
   * The generation of this app's database, as `v1`, `v2`, … — or `""` for an
   * app with no database, which is most of them.
   *
   * Its tables live in the one database every app shares, named
   * `<store>_<generation>_<table>`, so the generation is both a
   * namespace and the migration mechanism: SQLite cannot `ALTER` most schema
   * changes into place, so a breaking change bumps this and copies the old rows
   * across in `migrate.sql`. The schema itself is in the app's `schema.sql`,
   * not here — `routes/db.ts` reads it on first use.
   */
  db: string;
  /**
   * Extra entry points inside `web/`, as bare filenames. The sidebar renders
   * one row per entry under the app, each opening at `/apps/<path>/<file>`
   * exactly as `entry` does. The manifest check fails if the file is missing.
   */
  children: string[];
  /**
   * Retired `#app=` ids that still resolve to this app. The live `id:` is the
   * only value written into new deep links and Recently opened.
   */
  aliases: string[];
  /**
   * Repo-relative path to this app's `route.ts`, when it has a backend.
   * Empty for apps that only use the shared `/api/data/` and `/api/db/`
   * handlers. The manifest check fails if this is set and `router.ts` does
   * not list it in `HANDLERS`.
   */
  backend: string;
  /**
   * How finished this app is: `active`, `parked`, or `reference`. Empty when
   * `app.yaml` leaves it out.
   */
  status: string;
}

export interface Section {
  name: string;
  sort_name: string;
  icon: string;
  color: string;
  sections: Section[];
}

export interface Appspace {
  name: string;
  icon: string;
  color: string;
  /**
   * True when this appspace declares `password_env:` in metadata. The env
   * var name itself is never sent to the browser.
   */
  locked: boolean;
  /**
   * True when this appspace declares `local_only:` in metadata — its apps
   * drive this machine, so `/api/` requests to them must come from loopback.
   * See `shared/auth.ts`.
   */
  localOnly: boolean;
  sections: Section[];
}

/** Discovery minus the machine-specific local checkout. */
export type Manifest = Omit<Discovery, "checkout">;

export interface Discovery {
  schema_version: number;
  /**
   * The local checkout, so the shell can build Keyboard Maestro links without
   * hardcoding a path. Null on Val Town, where there is nothing to open.
   */
  checkout: LocalCheckout | null;
  appspaces: Appspace[];
  apps: App[];
}

/** Discovery is stable between edits, so the walk runs once per process. */
let cached: Discovery | null = null;

interface Marker {
  /** Repository-relative path to the yaml file. */
  file: string;
  /** URL path under `/apps/`, and the folder that holds `web/` for a moved app. */
  directory: string;
}

function underApps(path: string): string | null {
  if (path.startsWith(APPS_ROOT)) return path.slice(APPS_ROOT.length);
  return null;
}

function skipped(directory: string): boolean {
  return directory.split("/").some((segment) => segment.startsWith("_") || segment.startsWith("."));
}

/**
 * Every `app.yaml` under `apps/`.
 *
 * Folders beginning with `_` or `.` are skipped, which is what keeps
 * `_templates/` and `_shared/` from registering themselves as apps.
 */
async function findMarkers(): Promise<Marker[]> {
  const paths = await listPaths();
  const markers: Marker[] = [];
  for (const path of paths) {
    const rest = underApps(path);
    if (rest === null) continue;
    const filename = rest.split("/").pop();
    if (filename !== MARKER) continue;
    const directory = rest.slice(0, -(filename.length + 1));
    if (!directory || skipped(directory)) continue;
    markers.push({ file: path, directory });
  }
  return markers.sort((a, b) => a.directory.localeCompare(b.directory));
}

/** Repository path of a file inside this app's `web/` folder. */
export function appFile(app: App, file: string): string {
  return `${APPS_ROOT}${app.path}/web/${file.replace(/^\/+/, "")}`;
}

/**
 * The app-tree path a `/apps/...` URL names, or null when the URL cannot name
 * one. Empty segments are dropped and `.`, `..`, and NUL are refused.
 *
 * The auth guard and the static handler must agree on this to the byte: if one
 * of them resolves `/apps//admin-sqlite1/` to an app and the other does not, the
 * disagreement is an authentication bypass. Hence one function, called by both.
 */
export function appTreePath(pathname: string): string | null {
  if (pathname !== "/apps" && !pathname.startsWith("/apps/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname.slice("/apps".length));
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.join("/");
}

/**
 * The app whose folder `rest` names or sits under, preferring the longest
 * path so nested folders cannot steal a shorter sibling's files.
 */
export function matchAppPath(apps: App[], rest: string): App | null {
  let best: App | null = null;
  for (const app of apps) {
    if (rest === app.path || rest.startsWith(`${app.path}/`)) {
      if (!best || app.path.length > best.path.length) best = app;
    }
  }
  return best;
}

/** Appspace name → `password_env` from metadata. Missing names are public. */
let cachedPasswordEnv: Map<string, string> | null = null;

function readPasswordEnv(yaml: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const record of listOfMaps(yaml, "appspaces")) {
    if (record.name && record.password_env) values.set(record.name, record.password_env);
  }
  return values;
}

/** The env var that holds `appspace`'s password, or null when it is public. */
export async function appspacePasswordEnv(appspace: string): Promise<string | null> {
  if (!cachedPasswordEnv) {
    cachedPasswordEnv = readPasswordEnv(await readMetadataFile());
  }
  return cachedPasswordEnv.get(appspace) ?? null;
}

/** Appspace names that declared `local_only:` in metadata. */
let cachedLocalOnly: Set<string> | null = null;

function readLocalOnly(yaml: string): Set<string> {
  const names = new Set<string>();
  for (const record of listOfMaps(yaml, "appspaces")) {
    if (record.name && record.local_only === "true") names.add(record.name);
  }
  return names;
}

/**
 * Whether `appspace` may only be reached from this machine. Read from the same
 * metadata file as `password_env`, because both are appspace access policy and
 * an app should not be able to grant itself either one.
 */
export async function appspaceLocalOnly(appspace: string): Promise<boolean> {
  if (!cachedLocalOnly) {
    cachedLocalOnly = readLocalOnly(await readMetadataFile());
  }
  return cachedLocalOnly.has(appspace);
}

async function readMetadataFile(): Promise<string> {
  return (await readOptional(METADATA_FILE)) ?? "";
}

/**
 * Last commit date per app folder, as `YYYY-MM-DD`.
 *
 * One `git log` for the whole tree rather than one per app: discovery runs on
 * every dev-server start, and `--watch` makes that every save. The result is
 * empty wherever there is no repository to ask — Val Town serves from
 * `esm.town`, and an export has no history — which reads as an undated app
 * rather than an error.
 */
async function gitUpdated(directories: string[]): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  if (ON_VAL_TOWN) return dates;

  let log: string;
  try {
    const output = await new Deno.Command("git", {
      // NUL prefixes the date so it cannot be confused with a path.
      args: ["log", "--format=%x00%cs", "--name-only", "--", APPS_ROOT],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!output.success) return dates;
    log = new TextDecoder().decode(output.stdout);
  } catch {
    return dates;
  }

  let date = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("\0")) {
      date = line.slice(1).trim();
      continue;
    }
    if (!date || !line.startsWith(APPS_ROOT)) continue;
    for (const directory of directories) {
      // Commits arrive newest first, so the first date a folder appears under
      // is its answer. A rename shows only under the name it moved to.
      if (!dates.has(directory) && line.startsWith(`${APPS_ROOT}${directory}/`)) {
        dates.set(directory, date);
      }
    }
    if (dates.size === directories.length) break;
  }
  return dates;
}

function readSectionMetadata(yaml: string): Map<string, Section> {
  const metadata = new Map<string, Section>();
  for (const record of listOfMaps(yaml, "sections")) {
    const name = record.name;
    if (!name) continue;
    metadata.set(name, {
      name,
      sort_name: record.sort_name || name,
      icon: record.icon ?? "",
      color: record.color ?? "",
      sections: [],
    });
  }
  return metadata;
}

interface AppspaceMeta {
  icon: string;
  color: string;
  passwordEnv: string;
  localOnly: boolean;
}

/**
 * Per-appspace presentation from the `appspaces:` list in
 * `sections-metadata.yaml`. Appspace names come from each `app.yaml`, so this
 * file only supplies the icon, colour, and optional password env; an unlisted
 * appspace renders with the frontend's default icon and no colour.
 */
function readAppspaceMetadata(yaml: string): Map<string, AppspaceMeta> {
  const metadata = new Map<string, AppspaceMeta>();
  for (const record of listOfMaps(yaml, "appspaces")) {
    const name = record.name;
    if (!name) continue;
    metadata.set(name, {
      icon: record.icon ?? "",
      color: record.color ?? "",
      passwordEnv: record.password_env ?? "",
      localOnly: record.local_only === "true",
    });
  }
  return metadata;
}

interface Node {
  name: string;
  children: Map<string, Node>;
}

function addPath(roots: Map<string, Node>, path: string[]): void {
  let siblings = roots;
  for (const name of path) {
    let node = siblings.get(name);
    if (!node) {
      node = { name, children: new Map() };
      siblings.set(name, node);
    }
    siblings = node.children;
  }
}

function toSections(nodes: Map<string, Node>, metadata: Map<string, Section>): Section[] {
  return [...nodes.values()]
    .map((node) => {
      const configured = metadata.get(node.name);
      return {
        name: node.name,
        sort_name: configured?.sort_name || node.name,
        icon: configured?.icon ?? "",
        color: configured?.color ?? "",
        sections: toSections(node.children, metadata),
      };
    })
    .sort((a, b) => a.sort_name.localeCompare(b.sort_name) || a.name.localeCompare(b.name));
}

/** Read the folders and fold them into the generated manifest shape. */
export async function buildDiscovery(): Promise<Manifest> {
  const [metadataYaml, markers] = await Promise.all([readMetadataFile(), findMarkers()]);
  const metadata = readSectionMetadata(metadataYaml);
  const appspaceMetadata = readAppspaceMetadata(metadataYaml);
  const documents = await Promise.all(
    markers.map(async (marker) => ({ marker, yaml: await readTextFile(marker.file) })),
  );
  const appspaces = new Map<string, Map<string, Node>>();
  const apps: App[] = [];

  for (const { marker, yaml } of documents) {
    const fields = scalars(yaml);
    const directory = marker.directory;
    const missing = (["id", "name", "appspace"] as const).filter((key) => !fields[key]);
    if (missing.length > 0) {
      throw new Error(`${marker.file} is missing ${missing.join(", ")}`);
    }
    const appspace = fields.appspace!;
    const sections = list(yaml, "sections");

    let roots = appspaces.get(appspace);
    if (!roots) {
      roots = new Map();
      appspaces.set(appspace, roots);
    }
    addPath(roots, sections);

    const name = fields.name!;
    apps.push({
      id: fields.id!,
      name,
      sort_name: fields.sort_name || name,
      description: fields.description ?? "",
      updated: "",
      icon: fields.icon ?? "",
      color: fields.color ?? "",
      appspace,
      sections,
      tags: list(yaml, "tags"),
      path: directory,
      url: `/apps/${directory}/${fields.entry || "index.html"}`,
      store: fields.store ?? "",
      db: fields.db ?? "",
      children: list(yaml, "children"),
      aliases: list(yaml, "aliases"),
      backend: fields.backend ?? "",
      status: fields.status ?? "",
    });
  }

  const updated = await gitUpdated(apps.map((app) => app.path));
  for (const app of apps) app.updated = updated.get(app.path) ?? "";

  apps.sort((a, b) => a.sort_name.localeCompare(b.sort_name) || a.name.localeCompare(b.name));

  const discovery: Manifest = {
    schema_version: 1,
    appspaces: [...appspaces.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, roots]) => {
        const configured = appspaceMetadata.get(name);
        return {
          name,
          icon: configured?.icon ?? "",
          color: configured?.color ?? "",
          locked: Boolean(configured?.passwordEnv),
          localOnly: Boolean(configured?.localOnly),
          sections: toSections(roots, metadata),
        };
      }),
    apps,
  };

  if (markers.length === 0) {
    console.error(
      "Discovery found no app.yaml markers — the file listing is probably incomplete.",
    );
  }
  return discovery;
}

/** The committed manifest, or null when there is nothing usable to read. */
async function readManifest(): Promise<Manifest | null> {
  try {
    const parsed = JSON.parse(await readTextFile(MANIFEST_FILE));
    const usable = Array.isArray(parsed?.apps) && parsed.apps.length > 0 &&
      Array.isArray(parsed?.appspaces);
    return usable ? parsed as Manifest : null;
  } catch {
    return null;
  }
}

/** Use live folders locally and the precomputed manifest on Val Town. */
export async function discover(): Promise<Discovery> {
  if (cached) return cached;

  let manifest: Manifest | null = null;
  if (ON_VAL_TOWN) {
    manifest = await readManifest();
    if (!manifest) {
      console.error(
        `${MANIFEST_FILE} is missing or unusable — walking apps/ instead. Run \`deno task manifest\`.`,
      );
    }
  }
  manifest ??= await buildDiscovery();

  const discovery: Discovery = { ...manifest, checkout: localCheckout() };
  if (discovery.apps.length === 0) return discovery;

  cached = discovery;
  return cached;
}

/** `GET /api/apps` — the whole tree and every app record in one response. */
export async function handleApps(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname !== "/api/apps") return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }

  try {
    return json(await discover());
  } catch (error) {
    return json({ error: `Could not read apps/: ${errorMessage(error)}` }, 500);
  }
}
