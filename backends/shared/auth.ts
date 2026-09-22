/**
 * Optional per-appspace password grants.
 *
 * Public appspaces need no cookie. A locked appspace names its password in
 * `password_env:` (see `apps/sections-metadata.yaml`); a successful login adds
 * an HMAC grant for that appspace to the session cookie. There is no site-wide
 * password and no shared signing secret — each grant is keyed by its own
 * appspace password, so changing one does not invalidate the others.
 */

import { config } from "../../shared/config.ts";
import {
  type App,
  appspaceLocalOnly,
  appspacePasswordEnv,
  appTreePath,
  discover,
  matchAppPath,
} from "../routes/apps.ts";
import { json, methodNotAllowed, readOptional, restOf } from "./http.ts";

const COOKIE_NAME = config.sessionCookie;
const SESSION_SECONDS = config.sessionSeconds;
const SQLITE_ROUTE = "/api/sqlite";
const FILES_ROUTE = "/api/files";
const DATA_ROUTE = "/api/data/";
const DB_ROUTE = "/api/db/";
const APPS_API = "/api/apps";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Cookie payload: versioned map of appspace → [expiry, hmac]. */
export interface GrantCookie {
  v: 1;
  g: Record<string, [number, string]>;
}

export interface AppspaceScope {
  appspace: string;
  app: App | null;
}

const backendPrefixes = new Map<string, string>();

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] || null;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Length-independent comparison so a wrong guess leaks no timing signal. */
export function equalText(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let different = leftBytes.length ^ rightBytes.length;
  const longest = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < longest; index += 1) {
    different |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return different === 0;
}

/** HMAC of appspace + expiry, keyed by that appspace's password. */
export async function grantSignature(
  appspace: string,
  expiresAt: number,
  password: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`${appspace}\0${expiresAt}`)),
  );
  return toBase64Url(bytes);
}

export function encodeGrantCookie(grants: Record<string, [number, string]>): string {
  const payload: GrantCookie = { v: 1, g: grants };
  return toBase64Url(encoder.encode(JSON.stringify(payload)));
}

export function parseGrantCookie(token: string): GrantCookie | null {
  const bytes = fromBase64Url(token);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(decoder.decode(bytes)) as GrantCookie;
    if (parsed?.v !== 1 || !parsed.g || typeof parsed.g !== "object") return null;
    for (const grant of Object.values(parsed.g)) {
      if (
        !Array.isArray(grant) || grant.length !== 2 ||
        !Number.isSafeInteger(grant[0]) || typeof grant[1] !== "string"
      ) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function grantsFrom(request: Request): Record<string, [number, string]> {
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return {};
  return parseGrantCookie(token)?.g ?? {};
}

function cookieHeader(value: string, request: Request, maxAge = SESSION_SECONDS): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function setGrantCookie(
  request: Request,
  grants: Record<string, [number, string]>,
): string {
  const names = Object.keys(grants);
  if (names.length === 0) return clearCookieHeader();
  return cookieHeader(encodeGrantCookie(grants), request);
}

export async function verifyGrant(
  appspace: string,
  expiresAt: number,
  signed: string,
  password: string,
): Promise<boolean> {
  if (expiresAt <= Math.floor(Date.now() / 1000) || !signed) return false;
  return equalText(signed, await grantSignature(appspace, expiresAt, password));
}

export async function hasGrant(request: Request, appspace: string): Promise<boolean> {
  const passwordEnv = await appspacePasswordEnv(appspace);
  if (!passwordEnv) return true;
  const password = Deno.env.get(passwordEnv);
  if (!password) return false;
  const grant = grantsFrom(request)[appspace];
  if (!grant) return false;
  return await verifyGrant(appspace, grant[0], grant[1], password);
}

async function backendPrefix(app: App): Promise<string | null> {
  if (!app.backend) return null;
  const cached = backendPrefixes.get(app.path);
  if (cached) return cached;
  const source = await readOptional(app.backend);
  const match = source?.match(/const PREFIX\s*=\s*["']([^"']+)["']/);
  const prefix = match?.[1] ?? `/api/apps/${app.path}`;
  backendPrefixes.set(app.path, prefix);
  return prefix;
}

/**
 * The appspace guarding the routes that read across the whole repository rather
 * than one app: the SQLite inspector, which can list every app's tables, and
 * the file inventory. They follow the inspector app's appspace, and fall back
 * to a locked appspace rather than to a name that may not exist — a missing
 * `admin-sqlite1` must not turn either route public.
 */
async function platformAppspace(apps: App[]): Promise<{ appspace: string; app: App | null }> {
  const inspector =
    apps.find((app) => app.id === "admin-sqlite1" || app.path === "admin-sqlite1") ?? null;
  if (inspector) return { appspace: inspector.appspace, app: inspector };
  const { appspaces } = await discover();
  const locked = appspaces.find((appspace) => appspace.locked);
  return { appspace: locked?.name ?? "", app: null };
}

/**
 * The appspace this request is asking to enter, or null when the route is
 * platform-public (gallery, `/shared/*`, `/api/apps`, auth endpoints).
 */
export async function requiredAppspace(request: Request): Promise<AppspaceScope | null> {
  const { pathname } = new URL(request.url);
  if (
    pathname === "/api/auth/session" ||
    pathname === "/api/auth/appspace/login" ||
    pathname === "/api/auth/appspace/logout" ||
    pathname === "/login"
  ) return null;
  if (pathname === APPS_API) return null;

  const { apps } = await discover();

  if (
    pathname === SQLITE_ROUTE || pathname.startsWith(`${SQLITE_ROUTE}/`) ||
    pathname === FILES_ROUTE
  ) {
    const scope = await platformAppspace(apps);
    return scope.appspace ? scope : null;
  }

  if (pathname.startsWith(DATA_ROUTE)) {
    const rest = restOf(pathname, DATA_ROUTE);
    if (rest === null) return null;
    const segments = rest.split("/").filter(Boolean);
    segments.pop();
    const path = segments.join("/");
    if (!path) return null;
    const app = apps.find((candidate) => candidate.path === path) ?? null;
    return app ? { appspace: app.appspace, app } : null;
  }

  if (pathname.startsWith(DB_ROUTE) || pathname.startsWith("/api/shell-history/")) {
    const prefix = pathname.startsWith(DB_ROUTE) ? DB_ROUTE : "/api/shell-history/";
    const rest = restOf(pathname, prefix);
    if (rest === null) return null;
    const path = rest.split("/").filter(Boolean).join("/");
    if (!path) return null;
    const app = apps.find((candidate) => candidate.path === path) ?? null;
    return app ? { appspace: app.appspace, app } : null;
  }

  if (pathname.startsWith(`${APPS_API}/`)) {
    for (const app of apps) {
      const prefix = await backendPrefix(app);
      if (!prefix) continue;
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return { appspace: app.appspace, app };
      }
    }
    return null;
  }

  if (pathname === "/apps" || pathname.startsWith("/apps/")) {
    // Same normalisation as `routes/static.ts`, from the same function: an
    // extra slash used to resolve to no app here and to a locked app there.
    const rest = appTreePath(pathname);
    if (!rest) return null;
    const app = matchAppPath(apps, rest);
    return app ? { appspace: app.appspace, app } : null;
  }

  return null;
}

function galleryAuthUrl(request: Request, appspace: string, app: App | null): string {
  const next = new URL("/", request.url);
  next.searchParams.set("auth", appspace);
  if (app) next.hash = `app=${encodeURIComponent(app.id)}`;
  return `${next.pathname}${next.search}${next.hash}`;
}

export function appspaceAuthRequired(
  request: Request,
  scope: AppspaceScope,
): Response {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/")) {
    return json({
      error: "Authentication required",
      appspace: scope.appspace,
      code: "appspace_auth_required",
    }, 401);
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: galleryAuthUrl(request, scope.appspace, scope.app),
      "cache-control": "no-store",
    },
  });
}

export function appspaceAuthUnavailable(
  request: Request,
  appspace: string,
  passwordEnv: string,
): Response {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/")) {
    return json({
      error: `${passwordEnv} is not configured.`,
      appspace,
      code: "appspace_auth_unavailable",
    }, 503);
  }
  return new Response(`${passwordEnv} is not configured.\n`, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Whether a request reached us over loopback, from a page of our own origin.
 *
 * Two separate questions, because they fail differently. The hostname comes
 * from the `Host` header and rules out a browser that loaded the gallery by LAN
 * address — that page carries the address as its origin, so it cannot forge
 * its way past this. It is not a peer-address check: a handwritten request can
 * send `Host: localhost` from anywhere the port is reachable, which is why the
 * server binds to `config.host` rather than relying on this. The origin check
 * is the CSRF half — a cross-site page can POST with `mode: "no-cors"`, and
 * only the `Origin` header gives it away.
 */
function isLoopbackRequest(request: Request): boolean {
  const url = new URL(request.url);
  // `URL.hostname` keeps the brackets on an IPv6 literal, so a bare `::1`
  // would never match.
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

/**
 * Refuse an `/api/` request to a `local_only:` appspace that did not come from
 * this machine.
 *
 * Only `/api/`: the pages themselves stay reachable, and they render from API
 * data, so a blocked caller gets an empty app rather than a 403 in the frame.
 * `script-runner1` and the terminal used to each carry their own version of
 * this; the twelve other backends that spawn processes carried none. Declaring
 * it once on the appspace is what makes it uniform.
 */
export async function enforceLocalOnly(
  request: Request,
  scope: AppspaceScope,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/")) return null;
  if (!await appspaceLocalOnly(scope.appspace)) return null;
  if (isLoopbackRequest(request)) return null;
  return json({
    error: "This app runs on the machine that serves it.",
    appspace: scope.appspace,
    code: "local_only",
  }, 403);
}

/**
 * Refuse any request that names a different origin.
 *
 * Localhost is not private: any page in any browser can reach this server, and
 * a cross-site one can POST to it with `mode: "no-cors"`. A request with no
 * `Origin` header is not cross-site — browsers always send one when it is.
 * The router runs this over everything, so a new backend gets it for free.
 */
export function crossOriginBlock(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const url = new URL(request.url);
  try {
    return new URL(origin).host === url.host ? null : json({ error: "Cross-origin request" }, 403);
  } catch {
    return json({ error: "Cross-origin request" }, 403);
  }
}

/**
 * Allow, 401/302, or 503 for a resolved appspace. Public appspaces (no
 * `password_env`) always allow.
 */
export async function enforceAppspace(
  request: Request,
  scope: AppspaceScope,
): Promise<Response | null> {
  const passwordEnv = await appspacePasswordEnv(scope.appspace);
  if (!passwordEnv) return null;
  if (!Deno.env.get(passwordEnv)) {
    return appspaceAuthUnavailable(request, scope.appspace, passwordEnv);
  }
  if (await hasGrant(request, scope.appspace)) return null;
  return appspaceAuthRequired(request, scope);
}

async function lockedAppspaces(): Promise<string[]> {
  const { appspaces } = await discover();
  return appspaces.filter((appspace) => appspace.locked).map((appspace) => appspace.name);
}

async function verifiedGrants(request: Request): Promise<string[]> {
  const names: string[] = [];
  for (const appspace of Object.keys(grantsFrom(request))) {
    if (await hasGrant(request, appspace)) names.push(appspace);
  }
  return names;
}

async function readJson(
  request: Request,
): Promise<{ ok: Record<string, unknown> } | { error: Response }> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { error: json({ error: "Request body is not an object." }, 400) };
    }
    return { ok: body as Record<string, unknown> };
  } catch {
    return { error: json({ error: "Request body is not JSON." }, 400) };
  }
}

/** Claim `/login` and `/api/auth/*`; return null otherwise. */
export async function handleAuth(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  if (pathname === "/login") {
    return new Response(null, {
      status: 302,
      headers: { location: "/", "cache-control": "no-store" },
    });
  }

  if (pathname === "/api/auth/session") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed("GET, HEAD");
    }
    return json({
      grants: await verifiedGrants(request),
      locked: await lockedAppspaces(),
    });
  }

  if (pathname === "/api/auth/appspace/login") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const body = await readJson(request);
    if ("error" in body) return body.error;
    const appspace = typeof body.ok.appspace === "string" ? body.ok.appspace : "";
    const attempt = typeof body.ok.password === "string" ? body.ok.password : "";
    if (!appspace) return json({ error: "Request names no appspace." }, 400);

    const passwordEnv = await appspacePasswordEnv(appspace);
    if (!passwordEnv) return json({ error: "That appspace is not locked.", appspace }, 400);
    const password = Deno.env.get(passwordEnv);
    if (!password) return appspaceAuthUnavailable(request, appspace, passwordEnv);
    if (!equalText(attempt, password)) {
      return json({ error: "Incorrect password.", appspace, code: "appspace_auth_required" }, 401);
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const grants = { ...grantsFrom(request) };
    grants[appspace] = [expiresAt, await grantSignature(appspace, expiresAt, password)];
    return new Response(
      JSON.stringify({ ok: true, appspace, expiresAt }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": setGrantCookie(request, grants),
          "cache-control": "no-store",
        },
      },
    );
  }

  if (pathname === "/api/auth/appspace/logout") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const body = await readJson(request);
    if ("error" in body) return body.error;
    const appspace = typeof body.ok.appspace === "string" ? body.ok.appspace : "";
    const grants = { ...grantsFrom(request) };
    if (appspace) delete grants[appspace];
    else {
      for (const name of Object.keys(grants)) delete grants[name];
    }
    return new Response(
      JSON.stringify({ ok: true, appspace: appspace || null }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": setGrantCookie(request, grants),
          "cache-control": "no-store",
        },
      },
    );
  }

  return null;
}
/** Gallery history follows the same appspace grants and local-only gates as app data. */
export async function historyVisibleApps(request: Request): Promise<App[]> {
  const { apps } = await discover();
  const allowed = new Set<string>();
  for (const appspace of new Set(apps.map((app) => app.appspace))) {
    const scope = { appspace, app: null };
    if (!await enforceAppspace(request, scope) && !await enforceLocalOnly(request, scope)) {
      allowed.add(appspace);
    }
  }
  return apps.filter((app) => allowed.has(app.appspace));
}
