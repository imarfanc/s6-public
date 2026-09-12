/**
 * Scan the repo for Iconify `prefix:name` references.
 *
 * Shared by `build-icons.ts` (fetch and write the sprite) and
 * `build-manifest.ts` (fail when a name is missing from the committed sprite).
 */

/** Only these Iconify collections are recognised, to keep matching tight. */
const PREFIXES = [
  "lucide",
  "mdi",
  "solar",
  "material-symbols",
  "ph",
  "tabler",
  "simple-icons",
  "carbon",
  // Longest first: the pattern alternates, and "thesvg" would otherwise be
  // tried against "thesvg-color:meta" and reject it.
  "thesvg-color",
  "thesvg",
];

const SCAN_EXTENSIONS = [".yaml", ".yml", ".html", ".js", ".ts", ".css", ".json", ".md"];
const SKIP_DIRECTORIES = [".git", "node_modules", "_other/generated/git", ".vt"];

/**
 * Matches both spellings of a reference: `lucide:house` as written in YAML and
 * JavaScript, and `lucide--house` as written in the sprite and in `<use href>`.
 */
const ICON_PATTERN = new RegExp(
  `\\b(${PREFIXES.join("|")})(?::|--)([a-z0-9][a-z0-9-]*)\\b`,
  "g",
);

async function* walk(directory: URL, relative = ""): AsyncGenerator<[URL, string]> {
  for await (const entry of Deno.readDir(directory)) {
    const path = `${relative}${entry.name}`;
    if (SKIP_DIRECTORIES.some((skip) => path === skip || path.startsWith(`${skip}/`))) {
      continue;
    }
    if (entry.isDirectory) {
      yield* walk(new URL(`${entry.name}/`, directory), `${path}/`);
    } else if (entry.isFile && SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield [new URL(entry.name, directory), path];
    }
  }
}

/** Every Iconify name referenced in the repo, grouped by collection. */
export async function collectIconNames(
  root: string,
  spritePath: string,
): Promise<Map<string, Set<string>>> {
  const byPrefix = new Map<string, Set<string>>();

  for await (const [url, path] of walk(new URL(`file://${root}`))) {
    if (path === spritePath) continue;
    const text = await Deno.readTextFile(url);
    for (const [, prefix, name] of text.matchAll(ICON_PATTERN)) {
      const names = byPrefix.get(prefix!) ?? new Set<string>();
      names.add(name!);
      byPrefix.set(prefix!, names);
    }
  }
  return byPrefix;
}

/** `<symbol id="prefix--name">` values in a sprite. */
export function spriteSymbolIds(sprite: string): Set<string> {
  return new Set([...sprite.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!));
}

/** `prefix:name` references with no matching symbol in the sprite. */
export function missingFromSprite(
  byPrefix: Map<string, Set<string>>,
  symbols: Set<string>,
): string[] {
  const missing: string[] = [];
  for (const [prefix, names] of byPrefix) {
    for (const name of names) {
      if (!symbols.has(`${prefix}--${name}`)) missing.push(`${prefix}:${name}`);
    }
  }
  return missing.sort();
}
