// Chrome owns registration in Local State. We only seed a brand-new profile's name.
// https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/common/pref_names.h
export function profileName(value: unknown): string {
  if (
    typeof value !== "string" || !value.trim() || value.trim().length > 60 ||
    /[\p{Cc}\/\\]/u.test(value)
  ) {
    throw new Error(
      "Use a profile name of 1–60 characters, without slashes or control characters.",
    );
  }
  return value.trim().normalize("NFC");
}
function sameName(a: string, b: string) {
  return a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
}
function safeDirectory(value: string) {
  return !!value && value !== "." && value !== ".." && !/[\/\\\p{Cc}]/u.test(value);
}
export interface Profile {
  name: string;
  directory: string;
  verified: boolean;
}
async function readObject(path: string): Promise<Record<string, any> | null> {
  try {
    const result = JSON.parse(await Deno.readTextFile(path));
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(`Invalid preferences: ${path}`);
    }
    return result;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}
export async function listProfiles(root: string): Promise<Profile[]> {
  const state = await readObject(`${root}/Local State`);
  if (!state) return [];
  const cache = state.profile?.info_cache;
  if (cache === undefined) return [];
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
    throw new Error("Chrome profile list has an unexpected format.");
  }
  const profiles: Profile[] = [];
  for (const [directory, info] of Object.entries(cache)) {
    if (!safeDirectory(directory) || !info || typeof info !== "object") continue;
    const name = (info as Record<string, unknown>).name;
    if (typeof name !== "string") continue;
    const prefs = await readObject(`${root}/${directory}/Preferences`);
    profiles.push({
      name,
      directory,
      // Chrome stores later renames in Local State; Preferences may retain its original name.
      verified: prefs !== null,
    });
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}
export async function profileDirectory(name: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(profileName(name).toLowerCase()),
  );
  return `AppSettings1-${
    Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("").slice(
      0,
      24,
    )
  }`;
}
export async function inspectProfile(root: string, name: string) {
  name = profileName(name);
  const matches = (await listProfiles(root)).filter((p) => sameName(p.name, name));
  if (matches.length > 1) {
    throw new Error("More than one Chrome profile has this name. Choose a unique name.");
  }
  const profile = matches[0];
  return {
    name,
    exists: !!profile,
    verified: profile?.verified ?? false,
    directory: profile?.directory ?? null,
  };
}
export async function createProfile(
  root: string,
  name: string,
  launch: (directory: string) => Promise<void>,
) {
  name = profileName(name);
  const existing = await inspectProfile(root, name);
  if (existing.exists) {
    if (!existing.verified) {
      throw new Error(
        "Chrome lists this profile but its Preferences file is missing. Open Chrome and repair or remove that profile there before retrying.",
      );
    }
    await launch(existing.directory!);
    return { ...existing, message: "Opened the existing profile; no duplicate was created." };
  }
  const directory = await profileDirectory(name);
  const path = `${root}/${directory}`;
  await Deno.mkdir(root, { recursive: true });
  try {
    await Deno.mkdir(path, { mode: 0o700 });
    await Deno.writeTextFile(
      `${path}/Preferences`,
      JSON.stringify({ profile: { name, using_default_name: false } }),
      { createNew: true, mode: 0o600 },
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    // Retry only our deterministic directory with the expected saved name. Never overwrite it.
    const prefs = await readObject(`${path}/Preferences`);
    if (typeof prefs?.profile?.name !== "string" || !sameName(prefs.profile.name, name)) {
      throw new Error(
        "Profile folder already exists with different settings. Choose another name.",
      );
    }
  }
  await launch(directory);
  // Chrome writes asynchronously. A launch is not proof of a registered profile.
  const result = await inspectProfile(root, name);
  return {
    ...result,
    directory,
    message: result.verified
      ? "Profile created and verified."
      : "Opened Chrome for this profile. Finish any welcome screen, then click Verify. If still pending, quit Chrome to flush its saved profile list and verify again.",
  };
}
const pending = new Set<string>();
export async function runProfiles(action: "list" | "verify" | "create", rawName?: unknown) {
  if (Deno.build.os !== "darwin") throw new Error("Run locally on macOS.");
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is unavailable.");
  const root = `${home}/Library/Application Support/Google/Chrome`;
  if (action === "list") return { profiles: await listProfiles(root) };
  const name = profileName(rawName);
  if (action === "verify") return await inspectProfile(root, name);
  const key = name.toLowerCase();
  if (pending.has(key)) {
    throw new Error("This profile is already being created. Verify in a moment.");
  }
  pending.add(key);
  try {
    // Resolve the installed app before writing any profile files.
    let app: string | undefined;
    for (
      const candidate of [
        "/Applications/Google Chrome.app",
        `${home}/Applications/Google Chrome.app`,
      ]
    ) {
      try {
        if ((await Deno.stat(candidate)).isDirectory) {
          app = candidate;
          break;
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    if (!app) throw new Error("Install Google Chrome in Applications first.");
    return await createProfile(root, name, async (directory) => {
      const result = await new Deno.Command("/usr/bin/open", {
        args: [
          "-n",
          "-a",
          app!,
          "--args",
          `--profile-directory=${directory}`,
          "--new-window",
          "chrome://newtab/",
        ],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(10000),
      }).output();
      if (!result.success) {
        throw new Error(
          "Could not open Chrome. The new profile is prepared; retry Create & open to continue.",
        );
      }
    });
  } finally {
    pending.delete(key);
  }
}
