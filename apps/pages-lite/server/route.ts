import { synthesizeInworldSpeech } from "./inworld-tts.ts";
import { listPaths, readTextFile, serve } from "../../../backends/shared/files.ts";
import { json, methodNotAllowed } from "../../../backends/shared/http.ts";

const ROOT = "apps/pages-lite/data/";
const ROUTE = "/api/apps/pages-lite/files";

export async function handlePagesLite(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/apps/pages-lite/tts") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const body = await request.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 1000) {
      return json({ error: "text must contain 1 to 1000 characters" }, 400);
    }
    const language = body.language ?? "en";
    if (!["en", "ur", "pa"].includes(language)) {
      return json({ error: "language must be en, ur, or pa" }, 400);
    }
    try {
      const audio = await synthesizeInworldSpeech({ text, language });
      return new Response(new Uint8Array(audio), {
        headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
      });
    } catch (error) {
      const missing = error instanceof Error && error.message.includes("INWORLD_API_KEY");
      return json({
        error: missing
          ? "INWORLD_API_KEY is not set on the server. Choose Device voice."
          : "Speech generation failed. Try again or choose Device voice.",
      }, missing ? 503 : 502);
    }
  }
  const documentPrefix = "/apps/pages-lite/data/";
  const standalone = url.pathname.startsWith(documentPrefix);
  if (url.pathname !== ROUTE && !standalone) return null;
  if (request.method !== "GET" && !(standalone && request.method === "HEAD")) {
    return methodNotAllowed(standalone ? "GET, HEAD" : "GET");
  }
  let documentName: string | null = null;
  if (standalone) {
    try {
      documentName = decodeURIComponent(url.pathname.slice(documentPrefix.length));
    } catch {
      return json({ error: "Invalid document path" }, 400);
    }
    if (
      documentName.split("/").some((part) => !part || part.startsWith(".")) ||
      documentName.includes("\0")
    ) {
      return json({ error: "File not found" }, 404);
    }
  }
  try {
    const files = (await listPaths())
      .filter((path) => path.startsWith(ROOT) && /\.(html?|md|toml|json)$/i.test(path))
      .map((path) => path.slice(ROOT.length))
      .filter((path) => !path.split("/").some((part) => part.startsWith(".")))
      .sort((a, b) => a.localeCompare(b));
    if (documentName !== null) {
      if (!files.includes(documentName)) return json({ error: "File not found" }, 404);
      const response = await serve(ROOT + documentName);
      if (!response) return json({ error: "File not found" }, 404);
      if (request.method === "HEAD") {
        await response.body?.cancel();
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    }
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
