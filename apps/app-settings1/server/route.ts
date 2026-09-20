import { launchAiSearch } from "./ai-search.ts";
import { json, methodNotAllowed } from "../../../backends/shared/http.ts";
import { ON_VAL_TOWN } from "../../../backends/shared/files.ts";
import { controlApp, runSetting } from "./settings.ts";
import { runSearch, verifyAllSearch } from "./search.ts";
import { launchAiProfile, type SignIn, signInOptions } from "./ai-profiles.ts";
import { profileName, runProfiles } from "./profiles.ts";

export async function handleAppSettings(
  request: Request,
  run = runSetting,
  control = controlApp,
  profiles = runProfiles,
  launchAi = launchAiProfile,
  search = runSearch,
  aiSearch = launchAiSearch,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/apps/app-settings1/")) return null;
  const profileMatch = path.match(
    /^\/api\/apps\/app-settings1\/chrome-profiles\/(list|verify|create|ai-create)$/,
  );
  if (profileMatch) {
    const action = profileMatch[1] as "list" | "verify" | "create" | "ai-create";
    const method = action === "create" || action === "ai-create" ? "POST" : "GET";
    if (request.method !== method) return methodNotAllowed(method);
    if (ON_VAL_TOWN) return json({ error: "Run this app locally on your Mac." }, 503);
    let name: string | undefined;
    let signIn: SignIn | undefined;
    if (action !== "list") {
      try {
        const body = method === "POST" ? await request.json() : {};
        if (!body || typeof body !== "object") throw new Error("Invalid request body.");
        name = profileName(
          method === "POST" ? body.name : new URL(request.url).searchParams.get("name"),
        );
        if (action === "ai-create") signIn = signInOptions(body);
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : "Invalid profile name." },
          400,
        );
      }
    }
    try {
      return json(
        action === "ai-create" ? await launchAi(name, signIn) : await profiles(action, name),
      );
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Profile operation failed." },
        503,
      );
    }
  }
  const searchMatch = path.match(
    /^\/api\/apps\/app-settings1\/chrome-search\/(verify|verify-all|open|ai-apply|ai-all)$/,
  );
  if (searchMatch) {
    const action = searchMatch[1] as "verify" | "verify-all" | "open" | "ai-apply" | "ai-all";
    const method = action === "verify" || action === "verify-all" ? "GET" : "POST";
    if (request.method !== method) return methodNotAllowed(method);
    if (ON_VAL_TOWN) return json({ error: "Run this app locally on your Mac." }, 503);
    try {
      return json(
        action === "ai-apply" || action === "ai-all"
          ? await aiSearch(action === "ai-all")
          : action === "verify-all"
          ? await verifyAllSearch()
          : await search(action),
      );
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Search engine check failed." },
        503,
      );
    }
  }
  const match = path.match(
    /^\/api\/apps\/app-settings1\/(chrome|keyboard-maestro)\/(verify|apply|quit|open)$/,
  );
  if (!match) return json({ error: "Unknown setting or action" }, 404);
  const app = match[1] as "chrome" | "keyboard-maestro";
  const action = match[2] as "verify" | "apply" | "quit" | "open";
  const method = action === "verify" ? "GET" : "POST";
  if (request.method !== method) return methodNotAllowed(method);
  if (ON_VAL_TOWN) return json({ error: "Run this app locally on your Mac." }, 503);
  try {
    return json(
      action === "verify" || action === "apply"
        ? await run(app, action)
        : await control(app, action),
    );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Setting operation failed." },
      503,
    );
  }
}
