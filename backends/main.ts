/**
 * s6
 *
 *   apps/                one folder per app, each with an `app.yaml`
 *   backends/            the shared platform (routes/ plus shared/)
 *   frontends/           the gallery shell
 *   shared/              tokens, components, and helpers used by every page
 */
import { config } from "../shared/config.ts";
import { handleRequest } from "./routes/router.ts";

/** Val Town calls this default export; `deno task dev` serves it locally. */
export default handleRequest;

if (import.meta.main) {
  Deno.serve({
    port: Number(Deno.env.get("PORT") ?? config.port),
    hostname: Deno.env.get("HOST") ?? config.host,
  }, handleRequest);
}
