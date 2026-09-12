# st6-public

Plain-HTML app browser. No build step, no framework, no dependencies.

Read the folder contract relevant to the change; routine edits do not require reading every doc:

- `apps/README.md` — one folder per app
- `backends/README.md` — platform routes, storage, remote imports
- `frontends/README.md` — gallery shell, markup, theme
- `shared/README.md` — config, YAML, SQL tokens
- `_other/tools/README.md` — `dev`, `check`, `icons`, `manifest`, chooser

`CLAUDE.md` is a symlink to this file.

## Layout

```txt
apps/          galleries, one folder per app
backends/      the shared platform
frontends/     the gallery shell
shared/        parsers and helpers used by every page
_other/
  tools/       portable scripts; `_config.ts` detects settings from disk
  data/        local seed (`<dbPrefix>/blob/`, sqlite)
  generated/   rebuildable output (git history)
  scratch/     gitignored; delete at will
  docs/        prose
```

Folders under `apps/` starting with `_` or `.` are skipped by discovery.

## Running locally

The server binds `127.0.0.1`. `Deno.serve` defaults to `0.0.0.0`, which put a shell, the file
browser and `osascript` on the local network with no password; `config.host` is the default now and
`HOST` overrides it for a deliberate session. Val Town is unaffected — it calls the default export
in `backends/main.ts` and never reaches `Deno.serve`.

`routes/router.ts` runs three gates before any handler, so a new backend inherits all three without
writing any of them:

1. **Cross-origin** — a request naming an origin that is not ours is `403`, always. A request with
   no `Origin` header is not cross-site.
2. **`password_env:`** — an appspace can opt in in `apps/sections-metadata.yaml`; that environment
   variable is the password for that appspace only.
3. **`local_only:`** — the appspace's `/api/` routes answer only a loopback request from our own
   origin. Use it for future apps that drive the host machine.

The `Examples` appspace is public. No password is needed for the starter app. Copy `.env.example` to
`.env` before running `dev` or `start`.

## Adding an app

Follow `apps/README.md`. App **backends** are registered by hand: import and a `HANDLERS` entry in
`backends/routes/router.ts`, `backend:` in `app.yaml`. Do not add a SQL passthrough for a "dynamic
query" — the browser sends a query name from `queries.sql`, never SQL.

## fmt and lint for app frontends

`deno.json` excludes `apps/**/web/**` and `apps/**/data/**` from fmt and lint on purpose. `web/`
mixes handwritten pages with vendored files (xterm, highlight), and those are not a Deno fmt/lint
target. App `server/**/*.ts` is in `deno task check`. App-root markdown is formatted. Do not flip
the web exclude without a pass that separates vendor from source.

## Completing work

- Carry the requested change through implementation and relevant verification. Fix failures caused
  by the change; when running or inspecting the result is part of the request, complete that too.
- Use `deno task check` for the full repository validation. For documentation-only changes, a
  focused formatting and diff check is sufficient. Repeat successful checks only after relevant
  edits or when an unresolved concern warrants it.
- Report what was verified, any concrete blockers, and anything left unverified.

## Maintaining agent guidance

Keep this file focused on repository-specific constraints and remove stale or redundant
instructions. Give skills short descriptions with precise triggers. For multiple workflows, use a
small `SKILL.md` router to supporting references and scripts, loading only the material relevant to
the task.
