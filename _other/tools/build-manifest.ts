/**
 * Write `apps/_manifest.json` — the app tree, precomputed for Val Town.
 *
 *     deno task manifest
 *     deno task manifest --check
 *
 * The folders remain authoritative. The server walks them locally, while
 * production reads this committed file to avoid a network request per folder
 * and `app.yaml`. `--check` fails when the generated file is stale.
 *
 * `updated:` is derived from git, not written in `app.yaml`. `--check` compares
 * the tree with those dates stripped so a later commit in an app folder does
 * not fail the build until someone regenerates.
 */

import {
  buildDiscovery,
  type Manifest,
  MANIFEST_FILE,
  METADATA_FILE,
  ROUTER_FILE,
} from "../../backends/routes/apps.ts";
import { GENERATION } from "../../shared/app-sql.ts";
import { listOfMaps } from "../../shared/app-yaml.ts";
import { collectIconNames, missingFromSprite, spriteSymbolIds } from "./icon-scan.ts";
import { config } from "./_config.ts";
import { errorMessage, fail, info, muted, ok, warn } from "./style.ts";

const output = new URL(MANIFEST_FILE, `file://${config.root}`);
const checkOnly = Deno.args.includes("--check");

const STATUSES = new Set(["active", "parked", "reference"]);
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const STORE = /^[A-Za-z0-9._-]+$/;
const PASSWORD_ENV = /^[A-Z][A-Z0-9_]*$/;
const KNOWN_FIELDS = new Set([
  "id",
  "status",
  "name",
  "sort_name",
  "description",
  "icon",
  "color",
  "appspace",
  "sections",
  "tags",
  "store",
  "db",
  "entry",
  "backend",
  "children",
  "aliases",
]);

function serialise(manifest: unknown): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function withoutDates(manifest: Manifest): Manifest {
  return {
    ...manifest,
    apps: manifest.apps.map((app) => ({ ...app, updated: "" })),
  };
}

async function readCommitted(): Promise<string | null> {
  try {
    return await Deno.readTextFile(output);
  } catch {
    return null;
  }
}

function exists(path: string): Promise<boolean> {
  return Deno.stat(`${config.root}${path}`).then(() => true, () => false);
}

function parseRouter(source: string): { imported: Map<string, string>; handlers: Set<string> } {
  const imported = new Map<string, string>();
  for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)) {
    const spec = new URL(match[2]!, `file:///${ROUTER_FILE}`).pathname.replace(/^\//, "");
    for (const name of match[1]!.split(",")) {
      const ident = name.trim().split(/\s+as\s+/).at(-1)?.trim();
      if (ident) imported.set(ident, spec);
    }
  }
  const block = source.match(/const HANDLERS\s*=\s*\[([\s\S]*?)\];/);
  const handlers = new Set(
    (block?.[1] ?? "").split(",").map((item) => item.trim()).filter((item) => /^\w+$/.test(item)),
  );
  return { imported, handlers };
}

function topLevelKeys(yaml: string): string[] {
  const keys: string[] = [];
  for (const line of yaml.split("\n")) {
    const field = line.match(/^([a-z][a-z0-9_]*):/);
    if (field) keys.push(field[1]!);
  }
  return keys;
}

let manifest;
try {
  manifest = await buildDiscovery();
} catch (error) {
  fail(`could not read apps/: ${errorMessage(error)}`);
}

if (manifest.apps.length === 0) fail("no apps found under apps/ — refusing to write an empty tree");

try {
  await assertIntegrity(manifest);
} catch (error) {
  fail(errorMessage(error));
}

const next = serialise(manifest);
const committed = await readCommitted();
const summary = `${manifest.apps.length} app${manifest.apps.length === 1 ? "" : "s"} in ` +
  `${manifest.appspaces.length} appspace${manifest.appspaces.length === 1 ? "" : "s"} ` +
  muted(manifest.appspaces.map((appspace) => appspace.name).join(", "));

const nextComparable = serialise(withoutDates(manifest));
let committedComparable = "";
if (committed !== null) {
  try {
    committedComparable = serialise(withoutDates(JSON.parse(committed) as Manifest));
  } catch {
    committedComparable = "";
  }
}

if (checkOnly) {
  // Derived dates are excluded here and nowhere else: a commit in an app folder
  // moves them without anybody editing a file, and failing `check` for that
  // would mean a commit-then-regenerate loop with no end.
  if (committedComparable === nextComparable) {
    ok(`${MANIFEST_FILE} is up to date ${muted(`(${summary})`)}`);
  } else {
    warn(committed === null ? `${MANIFEST_FILE} does not exist` : `${MANIFEST_FILE} is stale`);
    fail("run `deno task manifest`");
  }
} else if (committed === next) {
  ok(`${MANIFEST_FILE} is up to date ${muted(`(${summary})`)}`);
} else {
  await Deno.writeTextFile(output, next);
  info(summary);
  ok(
    `wrote ${MANIFEST_FILE} ${muted(`(${next.length} bytes)`)}` +
      (committed === null ? "" : muted(" — commit it with the app change")),
  );
}

async function assertIntegrity(manifest: Manifest): Promise<void> {
  const problems: string[] = [];
  const byId = new Map<string, string[]>();
  for (const app of manifest.apps) {
    const paths = byId.get(app.id) ?? [];
    paths.push(app.path);
    byId.set(app.id, paths);
    for (const alias of app.aliases) {
      const aliasPaths = byId.get(alias) ?? [];
      aliasPaths.push(`${app.path} (alias)`);
      byId.set(alias, aliasPaths);
    }
  }
  for (const [id, paths] of byId) {
    if (paths.length > 1) {
      problems.push(`duplicate id ${id}: ${paths.join(", ")}`);
    }
  }

  const metadataYaml = await Deno.readTextFile(new URL(METADATA_FILE, `file://${config.root}`));
  const defined = new Set(
    listOfMaps(metadataYaml, "sections").map((record) => record.name).filter(Boolean),
  );
  const used = new Set(manifest.apps.flatMap((app) => app.sections));
  for (const name of used) {
    if (!defined.has(name)) {
      problems.push(`section ${JSON.stringify(name)} is used but not defined`);
    }
  }
  for (const name of defined) {
    if (!used.has(name!)) {
      problems.push(`section ${JSON.stringify(name)} is defined but unused`);
    }
  }

  const definedAppspaces = new Map(
    listOfMaps(metadataYaml, "appspaces")
      .filter((record) => record.name)
      .map((record) => [record.name!, record.password_env ?? ""]),
  );
  const usedAppspaces = new Set(manifest.apps.map((app) => app.appspace));
  for (const name of usedAppspaces) {
    if (!definedAppspaces.has(name)) {
      problems.push(`appspace ${JSON.stringify(name)} is used but not defined`);
    }
  }
  for (const [name, passwordEnv] of definedAppspaces) {
    if (passwordEnv && !PASSWORD_ENV.test(passwordEnv)) {
      problems.push(
        `appspace ${JSON.stringify(name)} password_env ${JSON.stringify(passwordEnv)} ` +
          `is not an environment variable name`,
      );
    }
  }
  // `local_only` is access control, and the parser reads it as a bare string:
  // `local_only: yes` would silently mean "public" rather than fail. Only the
  // exact value the reader in `routes/apps.ts` accepts is allowed here.
  for (const record of listOfMaps(metadataYaml, "appspaces")) {
    const value = record.local_only;
    if (value !== undefined && value !== "true" && value !== "false") {
      problems.push(
        `appspace ${JSON.stringify(record.name ?? "")} local_only ${JSON.stringify(value)} ` +
          `is not true or false`,
      );
    }
  }

  const router = await Deno.readTextFile(new URL(ROUTER_FILE, `file://${config.root}`));
  const { imported, handlers } = parseRouter(router);
  const importedByPath = new Map<string, string[]>();
  for (const [name, spec] of imported) {
    const names = importedByPath.get(spec) ?? [];
    names.push(name);
    importedByPath.set(spec, names);
  }

  for (const app of manifest.apps) {
    if (app.status && !STATUSES.has(app.status)) {
      problems.push(
        `${app.path} status ${JSON.stringify(app.status)} is not active, parked, or reference`,
      );
    }
    if (app.color && !COLOR.test(app.color)) {
      problems.push(`${app.path} color ${JSON.stringify(app.color)} is not a hex value`);
    }
    if (app.store && !STORE.test(app.store)) {
      problems.push(`${app.path} store ${JSON.stringify(app.store)} is not a safe namespace`);
    }
    if (app.db && !GENERATION.test(app.db)) {
      problems.push(`${app.path} db ${JSON.stringify(app.db)} is not a generation (v1, v2, …)`);
    }

    if (app.backend) {
      if (!await exists(app.backend)) {
        problems.push(`${app.path} backend ${app.backend} does not exist`);
      }
      const names = importedByPath.get(app.backend) ?? [];
      if (names.length === 0) {
        problems.push(`${app.path} backend ${app.backend} is not imported by ${ROUTER_FILE}`);
      } else if (!names.some((name) => handlers.has(name))) {
        problems.push(
          `${app.path} backend ${app.backend} is imported as ${
            names.join(", ")
          } but not listed in HANDLERS`,
        );
      }
    }

    for (const child of app.children) {
      if (child.includes("/") || child.includes("\\") || child.includes("\0")) {
        problems.push(`${app.path} child ${JSON.stringify(child)} is not a bare filename`);
        continue;
      }
      const file = `apps/${app.path}/web/${child}`;
      if (!await exists(file)) {
        problems.push(`${app.path} child ${child} does not exist at ${file}`);
      }
    }

    const yaml = await Deno.readTextFile(`${config.root}apps/${app.path}/app.yaml`);
    for (const key of topLevelKeys(yaml)) {
      if (!KNOWN_FIELDS.has(key)) {
        problems.push(`${app.path} unknown field ${key}`);
      }
    }
  }

  for (const [name, spec] of imported) {
    if (!spec.includes("/apps/") || !spec.endsWith("route.ts")) continue;
    if (!manifest.apps.some((app) => app.backend === spec)) {
      problems.push(`${spec} is imported as ${name} but no app.yaml backend: points at it`);
    }
  }

  try {
    const byPrefix = await collectIconNames(config.root, config.iconSprite);
    const sprite = await Deno.readTextFile(`${config.root}${config.iconSprite}`);
    for (const name of missingFromSprite(byPrefix, spriteSymbolIds(sprite))) {
      problems.push(`icon ${name} is not in ${config.iconSprite} — run \`deno task icons\``);
    }
  } catch (error) {
    problems.push(`could not check icon sprite: ${errorMessage(error)}`);
  }

  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
}
