/**
 * Project settings used by backends and the gallery shell.
 *
 * The frontend cannot import this TypeScript file (no build step), so
 * `routes/static.ts` serves `/shared/config.js` generated from `config.frontend`.
 * Change a value here rather than in those callers.
 *
 * `_other/tools` does not import this file. Those scripts detect their own
 * settings in `_other/tools/_config.ts` so `_other/` stays drop-in portable.
 *
 * `dbPrefix` names local blob/sqlite files and the migrations table. Val Town
 * storage is already scoped to the val, so blob keys stay unprefixed.
 */
const dbPrefix = "st6_public";

export const config = {
  /** Repo / product name. */
  name: "st6-public",
  port: 8893,
  /**
   * The interface `deno task dev` and `start` listen on. `Deno.serve` defaults
   * to `0.0.0.0`, which put every app on this machine — a shell, the file
   * browser, `osascript` — on the local network with no password in front of
   * it. Loopback is the default instead; `HOST` overrides it for a deliberate
   * "reach it from my phone" session. Val Town ignores both: it calls the
   * default export in `backends/main.ts` and never reaches `Deno.serve`.
   */
  host: "127.0.0.1",
  sessionCookie: "st6_public_session",
  sessionSeconds: 60 * 60 * 24 * 30,
  dbPrefix,
  dirs: {
    apps: "apps",
    frontend: "frontends",
  },
  files: {
    appYaml: "app.yaml",
    metadata: "apps/sections-metadata.yaml",
    manifest: "apps/_manifest.json",
    router: "backends/routes/router.ts",
    blob: `_other/data/${dbPrefix}/blob/`,
    sqlite: `_other/data/${dbPrefix}/sqlite.db`,
  },
  frontend: {
    title: "st6-public",
    storageKey: "st6-public.frontend",
    apiApps: "/api/apps",
    spriteUrl: "/shared/icons.svg",
    mobileQuery: "(max-width: 900px)",
    defaultAppspaceIcon: "solar:widget-bold-duotone",
    defaultSectionIcon: "solar:folder-bold-duotone",
    defaultAppIcon: "mdi:application-outline",
    defaultAppColor: "#8b5cf6",
    defaultChildIcon: "mdi:file-outline",
    chevronIcon: "mdi:chevron-right",
    externalIcon: "mdi:open-in-new",
    lockIcon: "lucide:lock",
    /**
     * App-tooltip Keyboard Maestro links. `{name}` is the checkout folder
     * (`st6-public`), `{path}` is the percent-encoded file or folder path.
     * The shell hides both actions when GET /api/apps has no checkout
     * (Val Town).
     */
    kmtriggerFile: "kmtrigger://macro={name}-file&value={path}",
    kmtriggerFolder: "kmtrigger://macro={name}-folder&value={path}",
  },
} as const;

/** ES module the gallery shell imports from `/shared/config.js`. */
export function frontendConfigScript(): string {
  return `export const frontend = ${JSON.stringify(config.frontend)};\n`;
}
