/**
 * Task discovery and picker geometry.
 *
 * The task list is read from the host repository's `deno.json` rather than
 * duplicated here, so dropping `_other/` into another repo shows that repo's
 * tasks with no edits.
 */

export type TaskGroup = "run" | "check" | "repo";

export interface Task {
  name: string;
  group: TaskGroup;
  description: string;
}

export type PickerRow =
  | { kind: "spacer" }
  | { kind: "heading"; group: TaskGroup }
  | { kind: "task"; task: Task; taskIndex: number };

export type MouseAction =
  | { kind: "click" | "move"; column: number; row: number }
  | { kind: "scroll"; delta: -1 | 1 };

/** Headings appear in this order; anything unrecognised falls to `repo`. */
export const GROUP_ORDER: TaskGroup[] = ["run", "check", "repo"];

const RUN_TASKS = ["dev", "start", "serve", "preview", "watch"];
const CHECK_TASKS = ["test", "check", "lint", "fmt", "format", "typecheck", "types"];

/** Descriptions for names we recognise; anything else shows its command. */
const KNOWN_DESCRIPTIONS: Record<string, string> = {
  dev: "Run the app with file watching",
  start: "Run the app once",
  serve: "Run the app once",
  test: "Run the tests",
  check: "Format-check, lint, type-check, and test",
  lint: "Lint the source",
  fmt: "Format the source",
  build: "Build the app",
  "captions:sync": "Prepare Caption Studio's Python environment",
  "captions:test": "Run Caption Studio's Python tests",
  "github:refresh": "Refresh the GitHub repository data",
  "git:history": "Refresh generated Git history",
  icons: "Build the shared icon sprite",
  manifest: "Rebuild the app manifest",
};

export function groupFor(name: string): TaskGroup {
  if (name === "captions:test") return "check";
  const base = name.split(":")[0]!;
  if (RUN_TASKS.includes(base)) return "run";
  if (CHECK_TASKS.includes(base)) return "check";
  return "repo";
}

/** Collapse a task's command to something that fits on one picker line. */
export function describe(name: string, command: string): string {
  const known = KNOWN_DESCRIPTIONS[name];
  if (known) return known;
  const flat = command.replace(/\s+/g, " ").trim();
  return flat.length > 52 ? `${flat.slice(0, 51)}…` : flat;
}

/** Strip comments and trailing commas so `deno.jsonc` parses as JSON. */
function parseConfig(text: string): Record<string, unknown> {
  const stripped = text
    .replace(
      /"(?:[^"\\]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      (match) => match.startsWith('"') ? match : "",
    )
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped) as Record<string, unknown>;
}

/** Read `deno.json` (or `deno.jsonc`) from `root` and return its tasks, grouped. */
export function readTasks(root: string): Task[] {
  let raw: Record<string, unknown> | undefined;
  for (const name of ["deno.json", "deno.jsonc"]) {
    try {
      raw = parseConfig(Deno.readTextFileSync(`${root}${name}`));
      break;
    } catch {
      continue;
    }
  }
  const entries = Object.entries((raw?.tasks ?? {}) as Record<string, unknown>);
  const tasks = entries
    .map(([name, value]) => ({
      name,
      command: typeof value === "string"
        ? value
        : String((value as { command?: unknown })?.command ?? ""),
    }))
    // The picker never lists the task that launches the picker.
    .filter(({ command }) => !command.includes("choose.ts"))
    .map(({ name, command }) => ({
      name,
      group: groupFor(name),
      description: describe(name, command),
    }));
  return tasks.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

export function pickerRows(tasks: Task[]): PickerRow[] {
  const rows: PickerRow[] = [];
  let previous: TaskGroup | undefined;
  tasks.forEach((task, taskIndex) => {
    if (task.group !== previous) {
      if (previous !== undefined) rows.push({ kind: "spacer" });
      rows.push({ kind: "heading", group: task.group });
      previous = task.group;
    }
    rows.push({ kind: "task", task, taskIndex });
  });
  return rows;
}

export function taskIndexAtScreenRow(
  rows: PickerRow[],
  screenRow: number,
  firstRow: number,
): number | null {
  const row = rows[screenRow - firstRow];
  return row?.kind === "task" ? row.taskIndex : null;
}

/** Parse xterm's SGR mouse format, enabled with terminal mode 1006. */
const MOUSE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[<(\\d+);(\\d+);(\\d+)([Mm])`);

export function parseMouse(input: string): MouseAction | null {
  const match = input.match(MOUSE_PATTERN);
  if (!match || match[4] !== "M") return null;
  const button = Number(match[1]);
  if (button === 35) return { kind: "move", column: Number(match[2]), row: Number(match[3]) };
  if (button === 0) {
    return { kind: "click", column: Number(match[2]), row: Number(match[3]) };
  }
  if (button === 64) return { kind: "scroll", delta: -1 };
  if (button === 65) return { kind: "scroll", delta: 1 };
  return null;
}

export function moveSelection(current: number, delta: number, count: number): number {
  return Math.max(0, Math.min(count - 1, current + delta));
}
