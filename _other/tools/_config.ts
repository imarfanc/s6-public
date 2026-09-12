/**
 * Configuration for the repository scripts in `_other/tools`.
 *
 * `_other/` is meant to be dropped into any Deno repository unchanged, so
 * nothing here is hardcoded to one project: the title, entrypoint, and watch
 * paths are detected from what is actually on disk. Set a value in `OVERRIDES`
 * only when detection guesses wrong.
 *
 * The port lives here and nowhere else: `serve.ts` passes it to the server as
 * `PORT`, and the fallback inside the entrypoint only applies when that file is
 * run directly.
 */

/** Per-repository pins. Leave a field out to let detection decide. */
const OVERRIDES: {
  title?: string;
  port?: number;
  entrypoint?: string;
  watchPaths?: string[];
  iconSprite?: string;
} = {};

const port = OVERRIDES.port ?? Number(Deno.env.get("PORT") ?? "8893");

/** Checked in order; the first one that exists wins. */
const ENTRYPOINT_CANDIDATES = [
  "main.ts",
  "mod.ts",
  "server.ts",
  "app.ts",
  "src/main.ts",
  "backends/main.ts",
  "backend/main.ts",
  "server/main.ts",
];

/** Every one of these that exists is watched in `dev`. */
const WATCH_CANDIDATES = [
  "src/",
  "backends/",
  "backend/",
  "frontends/",
  "frontend/",
  "shared/",
  "apps/",
  "routes/",
  "lib/",
  "public/",
  "static/",
];

/** Checked in order; the first path that exists, or the first whose parent dir exists. */
const ICON_SPRITE_CANDIDATES = [
  "frontends/shared/icons.svg",
  "public/shared/icons.svg",
  "shared/icons.svg",
];

const root = decodeURIComponent(new URL("../../", import.meta.url).pathname);

function exists(path: string): boolean {
  try {
    Deno.statSync(`${root}${path}`);
    return true;
  } catch {
    return false;
  }
}

function detectTitle(): string {
  return root.replace(/\/+$/, "").split("/").pop() || "app";
}

function detectEntrypoint(): string {
  return ENTRYPOINT_CANDIDATES.find(exists) ?? "main.ts";
}

function detectWatchPaths(): string[] {
  const found = WATCH_CANDIDATES.filter(exists);
  return found.length > 0 ? found : ["./"];
}

function detectIconSprite(): string {
  const hit = ICON_SPRITE_CANDIDATES.find(exists);
  if (hit) return hit;
  if (exists("frontends/")) return "frontends/shared/icons.svg";
  if (exists("public/")) return "public/shared/icons.svg";
  return "shared/icons.svg";
}

function detectGitOutput(): string {
  if (exists("_other/generated/")) return "_other/generated/git";
  return "_other/git";
}

export const config = {
  title: OVERRIDES.title ?? detectTitle(),
  root,
  port,
  baseUrl: `http://localhost:${port}/`,
  /** Passed to the server process so it listens on exactly this port. */
  serverEnv: { PORT: String(port) },
  entrypoint: OVERRIDES.entrypoint ?? detectEntrypoint(),
  watchPaths: OVERRIDES.watchPaths ?? detectWatchPaths(),
  heliumPath: "/Applications/Helium.app/Contents/MacOS/Helium",
  gitOutputDirectory: detectGitOutput(),
  /** Where `build-icons.ts` writes the vendored Iconify sprite. */
  iconSprite: OVERRIDES.iconSprite ?? detectIconSprite(),
} as const;
