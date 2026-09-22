/** Last opening per app. Separate blobs keep unrelated app writes independent. */
import { discover } from "./apps.ts";
import { historyVisibleApps } from "../shared/auth.ts";
import { read, write } from "../shared/blob.ts";
import { json, methodNotAllowed, restOf } from "../shared/http.ts";

const ROUTE = "/api/shell-history";
/** Storage can be supplied by tests without touching gallery data. */
export function historyStore(storage = { read, write }) {
  const writes = new Map<string, Promise<void>>();
  const key = (id: string) => `shell-history/${encodeURIComponent(id)}`;
  async function timestamp(id: string): Promise<number | null> {
    const value = await storage.read(key(id));
    if (value === null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Invalid stored history timestamp");
    return parsed;
  }
  /** Serialize local writes so an offline retry cannot overwrite a newer opening. */
  async function remember(id: string, opened: number): Promise<void> {
    const pending = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const previous = await timestamp(id);
      if (previous === null || opened > previous) await storage.write(key(id), String(opened));
    });
    writes.set(id, pending);
    try {
      await pending;
    } finally {
      if (writes.get(id) === pending) writes.delete(id);
    }
  }
  return { timestamp, remember };
}

const { timestamp, remember } = historyStore();

export async function handleShellHistory(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname !== ROUTE && !pathname.startsWith(`${ROUTE}/`)) return null;
  try {
    if (pathname === ROUTE) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      const apps = await historyVisibleApps(request);
      const entries = await Promise.all(apps.map(async (app) => [app.id, await timestamp(app.id)]));
      return json(Object.fromEntries(entries.filter(([, time]) => time !== null)));
    }
    if (request.method !== "PUT") return methodNotAllowed("PUT");
    const path = restOf(pathname, `${ROUTE}/`);
    const app = (await discover()).apps.find((app) => app.path === path);
    if (!app) return json({ error: "No such app." }, 404);
    if (Number(request.headers.get("content-length")) > 128) {
      return json({ error: "History entry is too large." }, 413);
    }
    const body = await request.text();
    if (body.length > 128) return json({ error: "History entry is too large." }, 413);
    let opened: unknown;
    try {
      opened = JSON.parse(body)?.opened;
    } catch {
      return json({ error: "Invalid history entry." }, 400);
    }
    if (typeof opened !== "number" || !Number.isFinite(opened) || opened < 0) {
      return json({ error: "Invalid opening time." }, 400);
    }
    await remember(app.id, Math.min(opened, Date.now()));
    return json({ ok: true });
  } catch (error) {
    console.error("History storage failed", error);
    return json({ error: "History storage is unavailable." }, 503);
  }
}
