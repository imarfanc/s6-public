import { listPaths, readTextFile } from "../../../backends/shared/files.ts";
import { json, methodNotAllowed } from "../../../backends/shared/http.ts";

const ROOT = "apps/pages-lite/data/";
const ROUTE = "/api/apps/pages-lite/files";
const HTML_ROUTE = "/apps/pages-lite/data/";

export async function handlePagesLite(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const directHTML = url.pathname.startsWith(HTML_ROUTE);
  if (url.pathname !== ROUTE && !directHTML) return null;
  if (request.method !== "GET") return methodNotAllowed("GET");
  try {
    const files = (await listPaths())
      .filter((path) => path.startsWith(ROOT) && /\.(html?|md|toml|json)$/i.test(path))
      .map((path) => path.slice(ROOT.length))
      .filter((path) => !path.split("/").some((part) => part.startsWith(".")))
      .sort((a, b) => a.localeCompare(b));
    let name = url.searchParams.get("file");
    if (directHTML) {
      try {
        name = decodeURIComponent(url.pathname.slice(HTML_ROUTE.length));
      } catch {
        return json({ error: "File not found" }, 404);
      }
      if (!/\.html?$/i.test(name)) return json({ error: "File not found" }, 404);
    }
    if (name !== null) {
      if (!files.includes(name)) return json({ error: "File not found" }, 404);
      const content = await readTextFile(ROOT + name);
      if (directHTML) {
        return new Response(content, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return json({ name, content });
    }
    return json({ files });
  } catch {
    return json({ error: "Could not read the data folder. Try refreshing." }, 500);
  }
}
