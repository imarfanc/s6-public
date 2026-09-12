/**
 * Small HTTP helpers shared by the platform routes.
 *
 * Each route used to carry its own `json()`, 405, and error-message ternary.
 * One module means one place to change a cache header.
 */

import { readTextFile } from "./files.ts";

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed\n", {
    status: 405,
    headers: { allow },
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readOptional(path: string): Promise<string | null> {
  try {
    return await readTextFile(path);
  } catch {
    return null;
  }
}

/**
 * The remainder of `pathname` after `prefix`, or null when the remainder
 * contains a NUL. Callers still have to reject `.` / `..` themselves if the
 * path is used as a filesystem lookup.
 */
export function restOf(pathname: string, prefix: string): string | null {
  const rest = decodeURIComponent(pathname.slice(prefix.length));
  return rest.includes("\0") ? null : rest;
}
