/**
 * The request router.
 *
 * Three gates, then the handlers. Every request must name our own origin or no
 * origin at all. Auth routes are reachable past that; everything else is public
 * unless it maps to an appspace with `password_env:` — those need a grant
 * cookie — or one with `local_only:`, whose `/api/` routes must come from
 * loopback. Handlers are tried in order and the first one to claim the request
 * wins; a handler returns null to pass. Adding a backend means adding one line
 * here, and it inherits all three gates without writing any of them.
 */

import {
  crossOriginBlock,
  enforceAppspace,
  enforceLocalOnly,
  handleAuth,
  requiredAppspace,
} from "../shared/auth.ts";
import { handleApps } from "./apps.ts";
import { handleData } from "./data.ts";
import { handleDb } from "./db.ts";
import { handleProjectFiles } from "./project-files.ts";
import { handleSqliteInspect } from "./sqlite-inspect.ts";
import { handleStatic } from "./static.ts";
import { methodNotAllowed } from "../shared/http.ts";

const HANDLERS = [
  handleApps,
  handleData,
  handleDb,
  handleSqliteInspect,
  handleProjectFiles,
  handleStatic,
];

export async function handleRequest(request: Request): Promise<Response> {
  const foreign = crossOriginBlock(request);
  if (foreign) return foreign;

  const authResponse = await handleAuth(request);
  if (authResponse) return authResponse;

  const scope = await requiredAppspace(request);
  if (scope) {
    const blocked = await enforceAppspace(request, scope) ??
      await enforceLocalOnly(request, scope);
    if (blocked) return blocked;
  }

  for (const handler of HANDLERS) {
    const response = await handler(request);
    if (response) return response;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }
  return new Response("Not found\n", { status: 404 });
}
