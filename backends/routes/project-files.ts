/**
 * Repository file inventory over HTTP: `GET /api/files`.
 *
 * The app only needs paths, not file contents. Authentication is already
 * settled by `routes/router.ts` before this handler runs: an inventory of the
 * whole repository is not per-app, so it is guarded by the same appspace as
 * `/api/sqlite` rather than being public.
 */

import { listPaths } from "../shared/files.ts";
import { errorMessage, json, methodNotAllowed } from "../shared/http.ts";

const ROUTE = "/api/files";
const SKIP_PATHS = new Set(["_other", ".vscode", ".vt", ".env", ".DS_Store"]);

function visible(path: string): boolean {
  return !path.split("/").some((segment) => SKIP_PATHS.has(segment));
}

export async function handleProjectFiles(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname !== ROUTE) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }

  try {
    const files = (await listPaths()).filter(visible).sort((a, b) => a.localeCompare(b));
    return json({ files, count: files.length, skipped: [...SKIP_PATHS] });
  } catch (error) {
    return json({ error: `Could not list project files: ${errorMessage(error)}` }, 500);
  }
}
