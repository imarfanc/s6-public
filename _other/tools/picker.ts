/** Shared terminal picker. Keeps the selected row visible on short terminals. */
import { moveSelection, parseMouse } from "./choose-lib.ts";
import {
  accent,
  bold,
  displayWidth,
  hint,
  hints,
  inverse,
  muted,
  padDisplay,
  rule,
  screen,
} from "./style.ts";

export type Choice = { name: string; description: string; details?: string[]; group: string };

export function clip(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let result = "";
  for (const char of text) {
    if (displayWidth(result + char) > Math.max(0, width - 1)) break;
    result += char;
  }
  return width > 0 ? `${result}…` : "";
}

/** Emit only changed rows; a new terminal size invalidates the whole frame. */
export function frameUpdate(previous: string[] | undefined, next: string[]): string {
  if (!previous) return `${screen.clear}${next.join("\n")}`;
  let output = "";
  for (let i = 0; i < Math.max(previous.length, next.length); i++) {
    if (previous[i] !== next[i]) {
      output += `${screen.position(i + 1)}${screen.clearLine}${next[i] ?? ""}`;
    }
  }
  return output;
}

export type MenuRow = { group: string; choice?: number };

export function groupedRows(choices: Choice[]): MenuRow[] {
  const rows: MenuRow[] = [];
  choices.forEach((choice, index) => {
    if (index === 0 || choice.group !== choices[index - 1]!.group) {
      rows.push({ group: choice.group });
    }
    rows.push({ group: choice.group, choice: index });
  });
  return rows;
}

/** Preserve a heading when a short viewport starts partway through a group. */
export function menuWindow(rows: MenuRow[], selected: number, top: number, capacity: number) {
  const selectedRow = rows.findIndex((row) => row.choice === selected);
  capacity = Math.max(2, capacity);
  if (selectedRow < top) top = Math.max(0, selectedRow - 1);
  while (true) {
    const sticky: MenuRow[] = rows[top]?.choice !== undefined ? [{ group: rows[top]!.group }] : [];
    const visible = [...sticky, ...rows.slice(top, top + capacity - sticky.length)];
    if (visible.some((row) => row.choice === selected)) return { top, visible };
    top++;
  }
}

export async function pick(
  title: string,
  subtitle: string,
  choices: Choice[],
): Promise<number | null> {
  if (!Deno.stdin.isTerminal() || !Deno.stdout.isTerminal()) {
    throw new Error("This menu needs a terminal; use a named task or push mode instead");
  }
  if (!choices.length) return null;
  let selected = 0;
  let top = 0;
  let visible: MenuRow[] = [];
  const rows = groupedRows(choices);
  const detailRows = Math.max(1, ...choices.map((choice) => choice.details?.length ?? 1));
  const encoder = new TextEncoder();
  const buffer = new Uint8Array(256);
  const decoder = new TextDecoder();
  let previous: string[] | undefined;
  let dimensions = "";
  function render() {
    const size = Deno.consoleSize();
    const nextDimensions = `${size.columns}/${size.rows}`;
    if (dimensions !== nextDimensions) previous = undefined;
    dimensions = nextDimensions;
    const width = Math.max(1, size.columns - 4);
    const count = Math.max(1, size.rows - 12 - (detailRows - 1));
    ({ top, visible } = menuWindow(rows, selected, top, count));
    const nameWidth = Math.min(25, Math.max(...choices.map((item) => displayWidth(item.name))));
    const lines = visible.map((row) => {
      if (row.choice === undefined) {
        return `  ${rule(clip(row.group, Math.max(0, width - 4)), width)}`;
      }
      const index = row.choice;
      const item = choices[index]!;
      const shortcut = index < 9 ? String(index + 1) : " ";
      const text = clip(
        `${index === selected ? "›" : " "} ${shortcut}  ${
          padDisplay(clip(item.name, nameWidth), nameWidth)
        }  ${item.description}`,
        width,
      );
      return `  ${index === selected ? inverse(bold(padDisplay(text, width))) : text}`;
    });
    const item = choices[selected]!;
    const heading = clip(
      `${selected + 1}/${choices.length} actions${
        top || rows.length > count ? " · scroll for more" : ""
      }`,
      width,
    );
    const body = [
      "",
      `  ${bold(accent(clip(title, width)))}`,
      `  ${muted(clip(subtitle, width))}`,
      `  ${muted(heading)}`,
      ...lines,
      "",
      `  ${accent(clip(item.name, width))}`,
      ...Array.from(
        { length: detailRows },
        (_, i) => `  ${muted(clip((item.details ?? [item.description])[i] ?? "", width))}`,
      ),
      "",
      `  ${
        width < 62 ? clip("↑↓ move · Enter select · q back", width) : hints(
          hint("↑↓", "move"),
          hint("Enter", "select"),
          hint(`1–${Math.min(9, choices.length)}`, "select"),
          hint("q", "back"),
        )
      }`,
    ];
    const update = frameUpdate(previous, body);
    if (update) Deno.stdout.writeSync(encoder.encode(update));
    previous = body;
  }
  const onResize = () => render();
  let listening = false;
  try {
    Deno.stdin.setRaw(true);
    Deno.stdout.writeSync(
      encoder.encode(`${screen.mouseOn}${screen.mouseMoveOn}${screen.hideCursor}`),
    );
    render();
    if (Deno.build.os !== "windows") {
      Deno.addSignalListener("SIGWINCH", onResize);
      listening = true;
    }
    while (true) {
      const length = await Deno.stdin.read(buffer);
      if (length === null) return null;
      const input = decoder.decode(buffer.subarray(0, length));
      if (["q", "\x03", "\x1b"].includes(input)) return null;
      const before = selected;
      const mouse = parseMouse(input);
      if (mouse?.kind === "scroll") selected = moveSelection(selected, mouse.delta, choices.length);
      else if (mouse?.kind === "click" || mouse?.kind === "move") {
        const hit = visible[mouse.row - 5]?.choice;
        if (hit !== undefined) {
          if (mouse.kind === "click" && selected === hit) return hit;
          selected = hit;
        }
      } else if (["\x1b[A", "k"].includes(input)) {
        selected = moveSelection(selected, -1, choices.length);
      } else if (["\x1b[B", "j"].includes(input)) {
        selected = moveSelection(selected, 1, choices.length);
      } else if (["\r", "\n"].includes(input)) return selected;
      else if (/^[1-9]$/.test(input) && Number(input) <= choices.length) return Number(input) - 1;
      if (selected !== before) render();
    }
  } finally {
    if (listening) Deno.removeSignalListener("SIGWINCH", onResize);
    Deno.stdin.setRaw(false);
    Deno.stdout.writeSync(
      encoder.encode(
        `${
          screen.position((previous?.length ?? 1) + 1)
        }${screen.mouseMoveOff}${screen.mouseOff}${screen.showCursor}\n`,
      ),
    );
  }
}
