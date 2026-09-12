/**
 * Static file serving for `frontends/` and the app tree.
 *
 * Everything under `/apps/` is an app file. Discovery already knows each app's
 * path; the longest match gets `web/` spliced in after it so colocated apps
 * serve from `apps/<id>/web/`. Paths outside an app folder are served only from
 * a `_shared/` folder — at the apps root, or nested under a group such as
 * `terminals/_shared/`. `/shared/config.js` is generated from `shared/config.ts`.
 */

import { config, frontendConfigScript } from "../../shared/config.ts";
import { serve } from "../shared/files.ts";
import { appFile, appTreePath, discover, matchAppPath } from "./apps.ts";

/**
 * Folders under `apps/` that are not apps but are still web-reachable: code an
 * app page imports. `_shared/` may sit at the apps root or under a group
 * folder. Everything else outside an app folder — `_manifest.json`,
 * `sections-metadata.yaml`, `_templates/` — is repository furniture and is not
 * served, so a URL cannot read the appspace policy that guards the tree.
 */
function isServedNonApp(rest: string): boolean {
  const segments = rest.split("/");
  const i = segments.indexOf("_shared");
  if (i < 0) return false;
  return segments.slice(0, i).every((segment) =>
    !segment.startsWith("_") && !segment.startsWith(".")
  );
}

/** Reject `..`, empty segments, and NUL so a URL cannot escape its root. */
function safeSegments(pathname: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const segments = decoded.split("/").filter(Boolean);
  return segments.some((segment) => segment === "." || segment === "..") ? null : segments;
}

function asFile(path: string): string {
  const last = path.split("/").filter(Boolean).at(-1);
  const isFile = last?.includes(".") ?? false;
  if (!last || !isFile) return `${path.replace(/\/+$/, "")}/index.html`.replace(/\/+/g, "/");
  return path;
}

async function serveFile(path: string): Promise<Response | null> {
  return await serve(asFile(path));
}

/**
 * Serve `pathname` from `root`, treating a directory as its `index.html` so
 * that `/apps/todo2` and `/apps/26.9/todo2/` both work.
 */
async function serveFrom(root: string, pathname: string): Promise<Response | null> {
  const segments = safeSegments(pathname);
  if (!segments) return null;
  return await serve(asFile([root, ...segments].join("/")));
}

export async function handleStatic(request: Request): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const { pathname } = new URL(request.url);
  if (pathname === "/apps" || pathname.startsWith("/apps/")) {
    const rest = appTreePath(pathname);
    if (!rest) return null;
    const { apps } = await discover();
    const app = matchAppPath(apps, rest);
    if (app) {
      const suffix = rest.slice(app.path.length).replace(/^\/+/, "");
      return await serveFile(appFile(app, suffix));
    }
    if (!isServedNonApp(rest)) return null;
    return await serveFile(`${config.dirs.apps}/${rest}`);
  }
  if (pathname === "/shared/config.js") {
    return new Response(frontendConfigScript(), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  return await serveFrom(config.dirs.frontend, pathname);
}
