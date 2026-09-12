/**
 * A reader for the small YAML subset used by `app.yaml` and
 * `sections-metadata.yaml`.
 *
 * These files only ever contain top-level scalars and flat lists of scalars, so
 * a full YAML parser would be a dependency bought for nothing. Anything outside
 * that subset — nested maps, multi-line strings, anchors — is ignored rather
 * than guessed at.
 */

/** Strip surrounding quotes and any trailing `# comment`. */
function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(['"])(.*?)\1(?:\s+#.*)?$/);
  return quoted ? quoted[2]! : trimmed.replace(/\s+#.*$/, "").trim();
}

/** Every `key: value` pair at the top level of the document. */
export function scalars(yaml: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const field = line.match(/^([a-z][a-z0-9_]*):\s*(.*)$/);
    if (field && field[2]!.trim() !== "") values[field[1]!] = unquote(field[2]!);
  }
  return values;
}

/** The items of a top-level `field:` list, in document order. */
export function list(yaml: string, field: string): string[] {
  const inline = yaml.match(new RegExp(`^${field}:\\s*\\[(.*)\\]\\s*$`, "m"));
  if (inline) {
    return inline[1]!.split(",").map(unquote).filter(Boolean);
  }

  const values: string[] = [];
  let active = false;
  for (const line of yaml.split("\n")) {
    if (new RegExp(`^${field}:\\s*(?:#.*)?$`).test(line)) {
      active = true;
      continue;
    }
    if (!active) continue;
    if (/^[a-z]/i.test(line)) break;
    const item = line.match(/^\s+-\s+(.+?)\s*$/);
    if (item) values.push(unquote(item[1]!));
  }
  return values.filter(Boolean);
}

/**
 * A list of maps, as used by `sections-metadata.yaml`:
 *
 * ```yaml
 * sections:
 *   - name: main
 *     icon: lucide:house
 * ```
 */
export function listOfMaps(yaml: string, field: string): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  let active = false;

  for (const line of yaml.split("\n")) {
    if (new RegExp(`^${field}:\\s*(?:#.*)?$`).test(line)) {
      active = true;
      continue;
    }
    if (!active) continue;
    if (/^[a-z]/i.test(line)) break;

    const first = line.match(/^\s+-\s+([a-z][a-z0-9_]*):\s*(.*)$/);
    if (first) {
      current = { [first[1]!]: unquote(first[2]!) };
      records.push(current);
      continue;
    }
    const field2 = line.match(/^\s+([a-z][a-z0-9_]*):\s*(.*)$/);
    if (field2 && current) current[field2[1]!] = unquote(field2[2]!);
  }
  return records;
}
