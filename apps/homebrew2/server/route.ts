import { json, methodNotAllowed } from "../../../backends/shared/http.ts";
import { ON_VAL_TOWN } from "../../../backends/shared/files.ts";

const PREFIX = "/api/apps/homebrew2";
const decoder = new TextDecoder();

export interface InstalledPackages {
  formulae: string[];
  casks: string[];
  scripts?: Record<string, { path: string | null; version: string | null }>;
  checkedAt: string;
}

// Only known executables are probed; installer commands are never executed.
export async function readScripts() {
  const home = Deno.env.get("HOME") || "";
  const directories = [
    ...new Set([
      ...(Deno.env.get("PATH") || "").split(":"),
      `${home}/.local/bin`,
      `${home}/.deno/bin`,
      `${home}/.atuin/bin`,
      `${home}/.opencode/bin`,
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ]),
  ].filter((path) => path.startsWith("/"));
  const entries = await Promise.all(
    ["opencode", "prime-agent", "pi", "atuin", "claude", "codex", "deno", "hf"].map(
      async (name) => {
        let path: string | null = null;
        for (const directory of directories) {
          const candidate = `${directory}/${name}`;
          try {
            const stat = await Deno.stat(candidate);
            if (stat.isFile && ((stat.mode ?? 0) & 0o111)) {
              path = candidate;
              break;
            }
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
          }
        }
        let version: string | null = null;
        if (path) {
          try {
            const result = await new Deno.Command(path, {
              args: ["--version"],
              stdin: "null",
              stdout: "piped",
              stderr: "piped",
              signal: AbortSignal.timeout(3_000),
            }).output();
            if (result.success) {
              // deno-lint-ignore no-control-regex -- strip terminal color escapes
              version = decoder.decode(result.stdout).replace(/\x1b\[[0-9;]*m/g, "")
                .trim().split(/\r?\n/)[0]?.slice(0, 200) || null;
            }
          } catch { /* An installed executable can lack a working version command. */ }
        }
        return [name, { path, version }] as const;
      },
    ),
  );
  return Object.fromEntries(entries);
}

async function list(brew: string, kind: "formula" | "cask"): Promise<string[]> {
  const result = await new Deno.Command(brew, {
    args: ["list", `--${kind}`, "-1"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(15_000),
    env: { HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ANALYTICS: "1" },
  }).output();
  if (!result.success) throw new Error(`Homebrew could not list installed ${kind} packages.`);
  return decoder.decode(result.stdout).split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
}

export async function readInstalled(): Promise<InstalledPackages> {
  if (ON_VAL_TOWN) throw new Error("Run this app locally on the Mac you want to check.");
  // Support GUI-launched servers whose PATH does not include Homebrew.
  for (const brew of ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "brew"]) {
    try {
      const results = await Promise.allSettled([list(brew, "formula"), list(brew, "cask")]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      const [formulae, casks] = results.map((result) =>
        (result as PromiseFulfilledResult<string[]>).value
      );
      return {
        formulae: formulae!,
        casks: casks!,
        scripts: await readScripts(),
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Homebrew check timed out. Try again.");
      }
      throw error;
    }
  }
  throw new Error("Homebrew was not found on this server. Install Homebrew, then try again.");
}

// Concurrent clicks share one scan, but subsequent refreshes always read fresh state.
let pending: Promise<InstalledPackages> | null = null;
function scan(): Promise<InstalledPackages> {
  return pending ??= readInstalled().finally(() => {
    pending = null;
  });
}

export async function handleHomebrew(
  request: Request,
  read: () => Promise<InstalledPackages> = scan,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== `${PREFIX}/installed`) return null;
  if (request.method !== "GET") return methodNotAllowed("GET");
  try {
    return json(await read());
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Could not check Homebrew. Try again.",
    }, 503);
  }
}
