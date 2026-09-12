import { config } from "./_config.ts";
import { icons } from "./icons.ts";
import {
  accent,
  bold,
  boxBottom,
  boxDivider,
  boxTop,
  clock,
  displayWidth,
  errorMessage,
  hyperlink,
  labels,
  muted,
  padDisplay,
  screen,
  success,
  warn,
} from "./style.ts";

type Mode = "dev" | "start";

interface Hotkey {
  key: string;
  icon: string;
  label: string;
  /** Omitted for keys that stop the server, which the input loop handles. */
  run?: () => void;
}

/** The single source of truth for the help text, the banner, and the key loop. */
const HOTKEYS: Hotkey[] = [
  {
    key: "b",
    icon: icons.browser,
    label: "default browser",
    run: () => void openBrowser(config.baseUrl),
  },
  {
    key: "h",
    icon: icons.helium,
    label: "Helium",
    run: () => void openBrowser(config.baseUrl, "Helium"),
  },
  {
    key: "a",
    icon: icons.app,
    label: "Helium app mode",
    run: () => void openAppMode(config.baseUrl),
  },
  { key: "c", icon: icons.copy, label: "copy the link", run: () => void copyLink(config.baseUrl) },
  { key: "x", icon: icons.exit, label: "exit" },
];

const mode = Deno.args[0] as Mode | undefined;
const help = Deno.args.includes("--help") || Deno.args.includes("-h");

if (help || (mode !== "dev" && mode !== "start")) {
  const list = HOTKEYS.map(({ key, label }) => `  ${key}  ${label}`).join("\n");
  console.log(`${bold("serve")} — run ${config.title} with browser hotkeys

Usage:
  deno task dev
  deno task start

Hotkeys:
${list}

Ctrl+C and Ctrl+D also stop the server.`);
  Deno.exit(help ? 0 : 1);
}

const args = ["run", "-A"];
if (mode === "dev") args.push(`--watch=${config.watchPaths.join(",")}`);
args.push(config.entrypoint);

const server = new Deno.Command(Deno.execPath(), {
  args,
  cwd: config.root,
  env: config.serverEnv,
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

let stopping = false;
let raw = false;
printBanner();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => void stop(signal === "SIGINT" ? "Ctrl+C" : signal));
}
if (Deno.stdin.isTerminal()) void watchInput();

const status = await server.status;
restoreInput();
Deno.exit(stopping ? 0 : status.code);

async function watchInput(): Promise<void> {
  try {
    Deno.stdin.setRaw(true, { cbreak: true });
    raw = true;
  } catch {
    raw = false;
  }
  const buffer = new Uint8Array(32);
  try {
    while (!stopping) {
      const count = await Deno.stdin.read(buffer);
      if (count === null) return await stop("Ctrl+D");
      for (let index = 0; index < count; index++) {
        const byte = buffer[index]!;
        if (byte === 0x03) return await stop("Ctrl+C");
        if (byte === 0x04) return await stop("Ctrl+D");
        const pressed = String.fromCharCode(byte).toLowerCase();
        const hotkey = HOTKEYS.find((candidate) => candidate.key === pressed);
        if (!hotkey) continue;
        if (!hotkey.run) return await stop(hotkey.key);
        hotkey.run();
      }
    }
  } catch (error) {
    if (!stopping) console.error(`${labels.error}${errorMessage(error)}`);
  }
}

async function stop(reason: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  restoreInput();
  console.log(`\n${muted(clock())} ${labels.info}shutting down ${muted(`via=${reason}`)}`);
  try {
    server.kill("SIGINT");
  } catch {
    return;
  }
  const stopped = await Promise.race([
    server.status.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 750)),
  ]);
  if (!stopped) {
    try {
      server.kill("SIGKILL");
    } catch {
      // The child exited between the timeout and signal.
    }
  }
}

function restoreInput(): void {
  if (!raw) return;
  raw = false;
  try {
    Deno.stdin.setRaw(false);
  } catch {
    // The terminal closed while the server was running.
  }
}

async function openBrowser(url: string, application?: string): Promise<void> {
  if (Deno.build.os !== "darwin") return warn("browser hotkeys are macOS-only");
  const args = application ? ["-a", application, url] : [url];
  try {
    const result = await new Deno.Command("open", {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).output();
    if (!result.success) return warn(`could not open ${application ?? "the default browser"}`);
    console.log(
      `${success("open")}  ${bold(url)} ${muted(`in ${application ?? "the default browser"}`)}`,
    );
  } catch (error) {
    warn(errorMessage(error));
  }
}

async function openAppMode(url: string): Promise<void> {
  if (Deno.build.os !== "darwin") return warn("Helium app mode is macOS-only");
  try {
    await Deno.stat(config.heliumPath);
    new Deno.Command(config.heliumPath, {
      args: [`--app=${url}`],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    console.log(`${success("open")}  ${bold(url)} ${muted("in Helium app mode")}`);
  } catch (error) {
    warn(
      error instanceof Deno.errors.NotFound
        ? `Helium is not installed at ${config.heliumPath}`
        : errorMessage(error),
    );
  }
}

async function copyLink(url: string): Promise<void> {
  if (Deno.build.os !== "darwin") return warn("copying the link is macOS-only");
  try {
    const process = new Deno.Command("pbcopy", {
      stdin: "piped",
      stdout: "null",
      stderr: "null",
    }).spawn();
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(url));
    await writer.close();
    if (!(await process.status).success) return warn("could not copy the link");
    console.log(`${success("copy")}  ${bold(url)} ${muted("on the clipboard")}`);
  } catch (error) {
    warn(errorMessage(error));
  }
}

function printBanner(): void {
  const info = [
    [icons.online, "URL", config.baseUrl],
    [icons.port, "Port", String(config.port)],
    [icons.mode, "Mode", mode === "dev" ? "watching" : "start once"],
    [icons.terminal, "Terminal", Deno.env.get("TERM_PROGRAM") ?? "not reported"],
  ];
  const hotkeys = HOTKEYS.map(({ icon, key, label }) => [icon, key, label]);
  const rows = [...info, ...hotkeys];
  const first = Math.max(...rows.map((row) => displayWidth(row[1]!)));
  const content = rows.map(([emoji, key, value]) =>
    `${emoji}  ${padDisplay(key!, first)}  ${value}`
  );
  const title = `${config.title} server`;
  const width = Math.max(34, displayWidth(title) + 2, ...content.map(displayWidth)) + 3;
  const rightColumn = width + 2;
  const keyColumn = 7;
  const valueColumn = keyColumn + first + 2;
  console.log("");
  console.log(boxTop(width));
  console.log(positionedRow("", "", title, rightColumn, keyColumn, valueColumn, true));
  console.log(boxDivider(width));
  for (const [icon, key, value] of info) {
    const shown = key === "URL" ? accent(hyperlink(value!)) : value!;
    console.log(positionedRow(icon!, muted(key!), shown, rightColumn, keyColumn, valueColumn));
  }
  console.log(positionedRow("", "", "", rightColumn, keyColumn, valueColumn));
  for (const [icon, key, value] of hotkeys) {
    console.log(
      positionedRow(icon!, bold(key!), muted(value!), rightColumn, keyColumn, valueColumn),
    );
  }
  console.log(boxBottom(width));
  console.log("");
}

/** Place columns through the terminal itself, avoiding emoji-width guesses. */
function positionedRow(
  icon: string,
  key: string,
  value: string,
  rightColumn: number,
  keyColumn: number,
  valueColumn: number,
  isTitle = false,
): string {
  if (!Deno.stdout.isTerminal()) {
    const plain = isTitle ? value : `${icon}  ${padDisplay(key, valueColumn - 7)}  ${value}`;
    return `│ ${padDisplay(plain, rightColumn - 4)} │`;
  }
  const edge = accent("│");
  if (isTitle) {
    return `${edge} ${bold(value)}${screen.column(rightColumn)}${edge}`;
  }
  return `${edge} ${icon}${screen.column(keyColumn)}${key}${screen.column(valueColumn)}${value} ${
    screen.column(rightColumn)
  }${edge}`;
}
