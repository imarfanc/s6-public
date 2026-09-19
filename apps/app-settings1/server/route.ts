import { json, methodNotAllowed } from "../../../backends/shared/http.ts";
import { ON_VAL_TOWN } from "../../../backends/shared/files.ts";
import { controlApp, runSetting } from "./settings.ts";

export async function handleAppSettings(
  request: Request,
  run = runSetting,
  control = controlApp,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/apps/app-settings1/")) return null;
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
