import { listProfiles } from "./profiles.ts";
// Chrome signs the default search engine in Secure Preferences and resets edited files,
// so we only read it here; the change itself happens in Chrome's own settings page.
const TARGET = "duckduckgo.com";

export function searchEngine(prefs: Record<string, any>) {
  const provider = prefs.default_search_provider_data;
  // Secure Preferences holds template_url_data; Preferences keeps a mirrored copy.
  const data = provider?.template_url_data ?? provider?.mirrored_template_url_data;
  if (!data || typeof data !== "object") return null;
  const name = typeof data.short_name === "string" ? data.short_name : null;
  const keyword = typeof data.keyword === "string" ? data.keyword : null;
  return name || keyword ? { name: name ?? keyword!, keyword } : null;
}
export function isDuckDuckGo(engine: { name: string; keyword: string | null } | null) {
  return engine?.keyword === TARGET || /^duckduckgo$/i.test(engine?.name ?? "");
}

// LaunchServices may discard Chrome's requested URL and open a New Tab page.
// Identify only the new window, then navigate it through Chrome's scripting API.
// Never fall back to the front window: it might belong to a different profile.
let openingSettings = false;
export async function openSearchSettings(profile: string) {
  if (openingSettings) throw new Error("Chrome settings are already opening. Please wait.");
  openingSettings = true;
  try {
    const result = await new Deno.Command("/usr/bin/osascript", {
      args: [
        "-e",
        `on run argv
  tell application "Google Chrome" to set previousIDs to id of every window
  set profileArgument to "--profile-directory=" & item 1 of argv
  do shell script "/usr/bin/open -n -a 'Google Chrome' --args " & quoted form of profileArgument & " --new-window chrome://settings/search"
  repeat 80 times
    tell application "Google Chrome"
      set newIDs to {}
      repeat with candidate in every window
        if id of candidate is not in previousIDs then set end of newIDs to id of candidate
      end repeat
      if (count of newIDs) > 1 then error "Multiple new Chrome windows appeared. Cannot safely identify the requested profile."
      if (count of newIDs) is 1 then
        set targetWindow to window id (item 1 of newIDs)
        set targetTab to active tab of targetWindow
        set URL of targetTab to "chrome://settings/search"
        set index of targetWindow to 1
        activate
        repeat 40 times
          if URL of targetTab is "chrome://settings/search" then return URL of targetTab
          delay 0.1
        end repeat
        error "Chrome did not reach chrome://settings/search."
      end if
    end tell
    delay 0.1
  end repeat
  error "Chrome did not open a new profile window. No existing tabs were changed."
end run`,
        profile,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(25000),
    }).output();
    if (!result.success) {
      throw new Error(
        `Could not open Chrome search settings: ${new TextDecoder().decode(result.stderr).trim()}`,
      );
    }
    if (new TextDecoder().decode(result.stdout).trim() !== "chrome://settings/search") {
      throw new Error("Chrome search settings URL was not confirmed.");
    }
  } finally {
    openingSettings = false;
  }
}

export async function runSearch(action: "verify" | "open", directory?: string) {
  if (Deno.build.os !== "darwin") throw new Error("Run locally on macOS.");
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is unavailable.");
  const root = `${home}/Library/Application Support/Google/Chrome`;
  let profile = "Default";
  let label = "Default";
  try {
    const state = JSON.parse(await Deno.readTextFile(`${root}/Local State`));
    const last = state?.profile?.last_used;
    if (typeof last === "string" && /^[^/\\]+$/.test(last)) profile = last;
    if (directory !== undefined) {
      if (
        !directory || directory === "." || directory === ".." || /[\/\\\p{Cc}]/u.test(directory) ||
        !Object.hasOwn(state?.profile?.info_cache ?? {}, directory)
      ) {
        throw new Error("Chrome profile is no longer available. Refresh and retry.");
      }
      profile = directory;
    }
    label = state?.profile?.info_cache?.[profile]?.name ?? profile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error("Chrome preferences not found. Install and open Chrome once first.");
    }
    throw error;
  }
  if (profile === "." || profile === "..") throw new Error("Invalid Chrome profile directory.");
  if (action === "open") {
    await openSearchSettings(profile);
    return {
      opened: true,
      message: `Opened search settings for ${label}. Choose DuckDuckGo, then Verify here.`,
      profile: label,
      directory: profile,
    };
  }
  let engine: ReturnType<typeof searchEngine> = null;
  for (const file of ["Secure Preferences", "Preferences"]) {
    try {
      engine = searchEngine(JSON.parse(await Deno.readTextFile(`${root}/${profile}/${file}`)));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (engine) break;
  }
  return {
    matches: isDuckDuckGo(engine),
    current: engine?.name ?? "Chrome default (usually Google)",
    profile: label,
    directory: profile,
  };
}

export async function searchProfiles() {
  if (Deno.build.os !== "darwin") throw new Error("Run locally on macOS.");
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is unavailable.");
  const profiles = await listProfiles(`${home}/Library/Application Support/Google/Chrome`);
  if (!profiles.length) throw new Error("No saved Chrome profiles found.");
  return profiles;
}
export async function verifyAllSearch() {
  const profiles = await searchProfiles();
  const results: Awaited<ReturnType<typeof runSearch>>[] = [];
  for (const profile of profiles) results.push(await runSearch("verify", profile.directory));
  return { profiles: results, matches: results.every((result) => result.matches) };
}
