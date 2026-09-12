/**
 * Persistent app storage, on Val Town and on a real filesystem.
 *
 * The counterpart to `files.ts`: that module reads the project's own files,
 * this one reads and writes whatever the apps put there. Val Town has no disk
 * that survives a deploy, so durable values go in its blob store; locally there
 * is no blob store to talk to, so the same calls use a directory. Everything
 * that touches app storage goes through this module so that split lives in one
 * place, exactly as it does for project files.
 *
 * Keys here are `namespace/name`, both restricted to `[A-Za-z0-9._-]` by
 * `routes/data.ts` before they arrive, and they are used as-is: Val Town's blob
 * store is scoped to the val, so there is nothing to share it with and no need
 * for a project prefix. Values are text; the route is what decides they happen
 * to be JSON.
 */

import { config } from "../../shared/config.ts";
import { ON_VAL_TOWN, REPO_ROOT } from "./files.ts";

/**
 * Imported through a variable so that a local `deno check` never tries to
 * resolve it — the blob store only exists on Val Town.
 */
const BLOB = "https://esm.town/v/std/blob/main.ts";

/** Tracked as local seed data; skipped by `files.ts` and by fmt and lint. */
const LOCAL_ROOT = new URL(config.files.blob, REPO_ROOT);

interface ValTownBlob {
  get(key: string): Promise<Response>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

let blobPromise: Promise<{ blob: ValTownBlob }> | null = null;

function store(): Promise<ValTownBlob> {
  blobPromise ??= import(BLOB) as Promise<{ blob: ValTownBlob }>;
  return blobPromise.then((module) => module.blob);
}

/** `a/b` is a nested path locally and a flat key on Val Town. */
function localPath(key: string): URL {
  return new URL(key, LOCAL_ROOT);
}

/** The stored value, or null when nothing is stored under `key`. */
export async function read(key: string): Promise<string | null> {
  if (ON_VAL_TOWN) {
    try {
      const response = await (await store()).get(key);
      return response.ok ? await response.text() : null;
    } catch {
      // std/blob throws rather than returning 404 for a key that is not there.
      return null;
    }
  }

  try {
    return await Deno.readTextFile(localPath(key));
  } catch {
    return null;
  }
}

export async function write(key: string, value: string): Promise<void> {
  if (ON_VAL_TOWN) {
    await (await store()).set(key, value);
    return;
  }

  const path = localPath(key);
  await Deno.mkdir(new URL(".", path), { recursive: true });
  await Deno.writeTextFile(path, value);
}

/** Removing a key that is not there succeeds, so callers need no pre-check. */
export async function remove(key: string): Promise<void> {
  if (ON_VAL_TOWN) {
    try {
      await (await store()).delete(key);
    } catch {
      // Already absent, which is the state the caller asked for.
    }
    return;
  }

  try {
    await Deno.remove(localPath(key));
  } catch {
    // As above.
  }
}
