export type App = "chrome" | "keyboard-maestro";
export type Action = "verify" | "apply" | "quit" | "open";
const decoder = new TextDecoder();
const domain = "com.stairways.keyboardmaestro.engine";
async function command(path: string, args: string[]) {
  return await new Deno.Command(path, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(5000),
  }).output();
}
function appNames(app: App) {
  return app === "chrome" ? ["Google Chrome"] : ["Keyboard Maestro", "Keyboard Maestro Engine"];
}
async function isRunning(name: string) {
  const result = await command("/usr/bin/pgrep", ["-x", name]);
  if (result.code > 1) throw new Error("Could not check running applications.");
  return result.success;
}
export async function controlApp(app: App, action: "quit" | "open") {
  if (Deno.build.os !== "darwin") throw new Error("Run locally on macOS.");
  const names = appNames(app);
  if (action === "open") {
    // Engine first so the editor finds it running.
    for (const name of [...names].reverse()) {
      const result = await command("/usr/bin/open", ["-a", name]);
      if (!result.success) throw new Error(`Could not open ${name}. Is it installed?`);
    }
    return { app, action, running: true, message: `Opened ${names.join(" and ")}.` };
  }
  for (const name of names) {
    // Guarded so quitting an app that is not running never launches it.
    await command("/usr/bin/osascript", [
      "-e",
      `if application "${name}" is running then tell application "${name}" to quit`,
    ]);
  }
  for (let i = 0; i < 20; i++) {
    const still: string[] = [];
    for (const name of names) if (await isRunning(name)) still.push(name);
    if (!still.length) {
      return { app, action, running: false, message: `Quit ${names.join(" and ")}.` };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("App is still running. Check it for an unsaved-changes dialog, then try again.");
}
async function requireClosed(app: App) {
  for (const name of appNames(app)) {
    const result = await command("/usr/bin/pgrep", ["-x", name]);
    if (result.success) throw new Error(`Quit ${name} first, then apply again. No changes made.`);
    if (result.code !== 1) throw new Error("Could not check running applications.");
  }
}
export function chromeValue(data: Record<string, any>): boolean | null {
  const value = data.browser?.confirm_to_quit;
  return typeof value === "boolean" ? value : null;
}
export function setChromeValue(data: Record<string, any>) {
  if (
    data.browser !== undefined &&
    (typeof data.browser !== "object" || data.browser === null || Array.isArray(data.browser))
  ) {
    throw new Error("Unexpected Chrome browser preferences; no changes made.");
  }
  data.browser ??= {};
  data.browser.confirm_to_quit = false;
  return data;
}
export async function runSetting(app: App, action: Action) {
  if (Deno.build.os !== "darwin") throw new Error("Run locally on macOS.");
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is unavailable.");
  let backup: string | null = null;
  if (action === "apply") await requireClosed(app);
  if (app === "chrome") {
    const path = `${home}/Library/Application Support/Google/Chrome/Local State`;
    const original = await Deno.readTextFile(path).catch((error) => {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error("Chrome preferences not found. Install and open Chrome once first.");
      }
      throw error;
    });
    let data = JSON.parse(original);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid Chrome preferences.");
    }
    if (action === "apply" && chromeValue(data) !== false) {
      setChromeValue(data);
      backup = `${path}.app-settings1-${crypto.randomUUID()}.bak`;
      await Deno.copyFile(path, backup);
      const temporary = await Deno.makeTempFile({
        dir: `${home}/Library/Application Support/Google/Chrome`,
        prefix: ".app-settings1-",
      });
      try {
        await Deno.writeTextFile(temporary, JSON.stringify(data), { mode: 0o600 });
        await requireClosed(app);
        if (await Deno.readTextFile(path) !== original) {
          throw new Error("Chrome preferences changed during apply. Try again.");
        }
        await Deno.rename(temporary, path);
      } finally {
        await Deno.remove(temporary).catch((error) => {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        });
      }
      data = JSON.parse(await Deno.readTextFile(path));
    }
    const value = chromeValue(data);
    return {
      app,
      matches: value === false,
      current: value === null ? "Not explicitly set" : value ? "Enabled" : "Disabled",
      backup,
      note:
        "Reads the saved setting for standard Google Chrome. Reopen Chrome to load changes; custom user-data directories are not included.",
    };
  }
  if (action === "apply") {
    const result = await command("/usr/bin/defaults", [
      "write",
      domain,
      "StatusMenuIcon",
      "-string",
      "Command",
    ]);
    if (!result.success) {
      throw new Error(
        decoder.decode(result.stderr).trim() || "Could not write Keyboard Maestro preference.",
      );
    }
  }
  const result = await command("/usr/bin/defaults", ["read", domain, "StatusMenuIcon"]);
  const current = result.success ? decoder.decode(result.stdout).trim() : null;
  if (!result.success && !/does not exist|Could not find/i.test(decoder.decode(result.stderr))) {
    throw new Error("Could not read Keyboard Maestro preferences.");
  }
  return {
    app,
    matches: current === "Command",
    current: current || "Not explicitly set",
    backup,
    note:
      "Status Menu Icon → Command. Display Status Menu grouping is unchanged. Reopen Keyboard Maestro and its Engine after applying.",
  };
}
