/**
 * Shared terminal styling for the repository scripts in `_other/tools`.
 *
 * One palette, one set of layout helpers, one set of message labels, so the
 * chooser, the serve banner, and every error read as the same program.
 */

const isTerminal = Deno.stdout.isTerminal();
const noColor = Boolean(Deno.env.get("NO_COLOR"));

/** Colour is on for terminals unless NO_COLOR asks otherwise. */
export const colorEnabled = isTerminal && !noColor;

const sgr = (open: string, text: string, close = "0") =>
  colorEnabled ? `\x1b[${open}m${text}\x1b[${close}m` : text;

export const bold = (text: string) => sgr("1", text, "22");
export const dim = (text: string) => sgr("2", text, "22");
export const italic = (text: string) => sgr("3", text, "23");
export const underline = (text: string) => sgr("4", text, "24");
export const inverse = (text: string) => sgr("7", text, "27");

/** Semantic colours. Prefer these over raw ANSI codes at the call site. */
export const accent = (text: string) => sgr("36", text);
export const success = (text: string) => sgr("32", text);
export const warning = (text: string) => sgr("33", text);
export const danger = (text: string) => sgr("31", text);
export const muted = dim;

/** A padded, colour-coded label such as the `error` in `error  no such task`. */
function label(paint: (text: string) => string, text: string): string {
  return `${paint(bold(text.padEnd(5)))} `;
}

export const labels = {
  info: label(accent, "info"),
  ok: label(success, "ok"),
  warn: label(warning, "warn"),
  error: label(danger, "error"),
} as const;

export function info(text: string): void {
  console.log(`${labels.info}${text}`);
}

export function ok(text: string): void {
  console.log(`${labels.ok}${text}`);
}

export function warn(text: string): void {
  console.error(`${labels.warn}${text}`);
}

export function error(text: string): void {
  console.error(`${labels.error}${text}`);
}

export function fail(text: string): never {
  error(text);
  Deno.exit(1);
}

export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** Cursor and screen control, grouped so scripts do not hand-roll escapes. */
export const screen = {
  clear: "\x1b[2J\x1b[H",
  clearLine: "\x1b[2K",
  position: (row: number, column = 1) => `\x1b[${row};${column}H`,
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  mouseMoveOn: "\x1b[?1003h",
  mouseMoveOff: "\x1b[?1003l",
  mouseOn: "\x1b[?1000h\x1b[?1006h",
  mouseOff: "\x1b[?1000l\x1b[?1006l",
  /** Move the cursor to an absolute column on the current line. */
  column: (index: number) => `\x1b[${index}G`,
} as const;

const ESCAPE = String.fromCharCode(27);
const SGR_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;]*[A-Za-z]`, "g");
const LINK_PATTERN = new RegExp(`${ESCAPE}\\]8;;.*?(${ESCAPE}\\\\|\u0007)`, "g");
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WIDE = /\p{Extended_Pictographic}/u;

/** Terminal columns, not JavaScript string length: emoji occupy two cells. */
export function displayWidth(text: string): number {
  const withoutEscapes = text.replace(SGR_PATTERN, "").replace(LINK_PATTERN, "");
  let width = 0;
  for (const { segment } of GRAPHEMES.segment(withoutEscapes)) {
    width += WIDE.test(segment) ? 2 : 1;
  }
  return width;
}

export function padDisplay(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

/** A `key description` pair for footer hints, joined with `hints()`. */
export function hint(key: string, description: string): string {
  return `${bold(key)} ${muted(description)}`;
}

export function hints(...pairs: string[]): string {
  return pairs.join(muted("  ·  "));
}

/** A titled section rule, for example `── RUN ─────────`. */
export function rule(title: string, width: number): string {
  const heading = title.toUpperCase();
  const trailing = Math.max(0, width - displayWidth(heading) - 4);
  return dim(`── ${heading} ${"─".repeat(trailing)}`);
}

/** OSC 8 so cmd-click opens the URL, not the neighbouring box border. */
export function hyperlink(url: string, text = url): string {
  return colorEnabled ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;
}

export const box = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  teeLeft: "├",
  teeRight: "┤",
} as const;

export function boxTop(width: number): string {
  return accent(`${box.topLeft}${box.horizontal.repeat(width)}${box.topRight}`);
}

export function boxDivider(width: number): string {
  return accent(`${box.teeLeft}${box.horizontal.repeat(width)}${box.teeRight}`);
}

export function boxBottom(width: number): string {
  return accent(`${box.bottomLeft}${box.horizontal.repeat(width)}${box.bottomRight}`);
}

export function clock(): string {
  return new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
