import { listPaths, readTextFile } from "../../../backends/shared/files.ts";
import { json, methodNotAllowed } from "../../../backends/shared/http.ts";

const ROOT = "apps/pages-lite/data/";
const ROUTE = "/api/apps/pages-lite/files";

export async function handlePagesLite(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return null;
  if (request.method !== "GET") return methodNotAllowed("GET");
  try {
    const files = (await listPaths())
      .filter((path) => path.startsWith(ROOT) && /\.(html?|md)$/i.test(path))
      .map((path) => path.slice(ROOT.length))
      .filter((path) => !path.split("/").some((part) => part.startsWith(".")))
      .sort((a, b) => a.localeCompare(b));
    const name = url.searchParams.get("file");
    if (name !== null) {
      if (!files.includes(name)) return json({ error: "File not found" }, 404);
      return json({ name, content: await readTextFile(ROOT + name) });
    }
    return json({ files });
  } catch {
    return json({ error: "Could not read the data folder. Try refreshing." }, 500);
  }
}
