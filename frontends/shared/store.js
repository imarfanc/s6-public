/**
 * Persistent storage for an app, over `/api/data/`.
 *
 * An app calls `store()` and gets something it can read and write; it does not
 * name itself, register a route, or know that a blob store exists. The URL is
 * derived from `location.pathname`, which for any page under `apps/` already
 * is the app's folder path — so this file is the same for every app, and a new
 * app that wants storage writes no backend code at all.
 *
 *     import { store } from "/shared/store.js";
 *
 *     const scene = store();
 *     const saved = await scene.get("scene");
 *     await scene.put("scene", { elements: [] });
 *
 * `get` and `put` are JSON. For anything else — YAML, CSV, Markdown, plain
 * text — use `getText` and `putText` and give the key an extension, which is
 * what tells the server how to serve it and how to check it:
 *
 *     await scene.putText("rows.csv", "a,b\n1,2\n");
 *
 * Both return null when nothing is stored yet, which is the normal state on an
 * app's first run rather than an error to handle.
 */

const ROUTE = "/api/data/";

/** `/apps/26.8a/excali-1a/editor.html` → `26.8a/excali-1a`. */
function appPath() {
  const segments = decodeURIComponent(location.pathname).split("/").filter(Boolean);
  if (segments[0] !== "apps") return null;
  // A trailing filename is a page, not a folder segment; a bare folder URL has none.
  const rest = segments.slice(1);
  if (rest.at(-1)?.includes(".")) rest.pop();
  return rest.length ? rest.join("/") : null;
}

class StoreError extends Error {}

async function request(url, init) {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new StoreError(detail?.error || `Storage request failed (${response.status}).`);
  }
  return response;
}

/**
 * A handle on this app's storage.
 *
 * `path` is only for pages served from somewhere other than their own app
 * folder; everything under `apps/` should leave it out.
 */
export function store(path = appPath()) {
  if (!path) throw new StoreError("Not running inside an app, so there is nowhere to store.");
  const base = `${ROUTE}${path}/`;

  return {
    path,

    /** The stored value as text, or null when the key has never been written. */
    async getText(key) {
      const response = await request(base + encodeURIComponent(key));
      return response ? await response.text() : null;
    },

    /**
     * Store `text` under `key`. The key's extension decides the format: the
     * server parses YAML, CSV and JSON on the way in and rejects a body that
     * does not parse, so a truncated write fails here rather than later.
     */
    async putText(key, text) {
      await request(base + encodeURIComponent(key), {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: text,
      });
    },

    /** The stored value as JSON, or null when the key has never been written. */
    async get(key) {
      const text = await this.getText(key);
      return text === null ? null : JSON.parse(text);
    },

    async put(key, value) {
      await this.putText(key, JSON.stringify(value));
    },

    /** Removing a key that was never written succeeds. */
    async remove(key) {
      await request(base + encodeURIComponent(key), { method: "DELETE" });
    },
  };
}

/**
 * Call `save(value)` as often as you like; it runs `delay` ms after the last
 * call. Writes never overlap — a call made while one is in flight queues the
 * newest value and runs once, so a fast editor cannot outrun the network.
 *
 * `onState` sees "saving", "saved", or an Error, which is enough to drive a
 * status line without the caller tracking any of this itself.
 */
export function autosave(write, { delay = 1000, onState = () => {} } = {}) {
  let timer = null;
  let pending = null;
  let inFlight = false;

  async function flush() {
    if (inFlight || pending === null) return;
    inFlight = true;
    while (pending !== null) {
      const value = pending;
      pending = null;
      onState("saving");
      try {
        await write(value);
        if (pending === null) onState("saved");
      } catch (error) {
        onState(error);
        break;
      }
    }
    inFlight = false;
  }

  return (value) => {
    pending = value;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
}
