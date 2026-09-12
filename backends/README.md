# backends

The shared platform. App backends live under `apps/<name>/server/`, not here.

```
main.ts          Val Town default export; `deno task dev` serves it locally
routes/          one handler per concern; `router.ts` is the list
shared/          files, blob, sqlite, auth — the ON_VAL_TOWN split
```

`shared/files.ts`, `blob.ts`, and `sqlite.ts` are the only modules that know storage exists. Val
Town in production, `_other/data/<dbPrefix>/` locally, one split each. `dbPrefix` is in
`shared/config.ts` and also names the migrations table (`<dbPrefix>_migrations`). Blob keys on Val
Town stay unprefixed — the store is already scoped to the val.

Adding an app backend: import the route and add a `HANDLERS` entry in `routes/router.ts`, set
`backend:` in `app.yaml`. The manifest check fails if the file is missing, not imported, or not
listed in `HANDLERS`.

Do not write access control into a `route.ts`. `shared/auth.ts` owns all three gates and
`routes/router.ts` runs them before any handler, so a backend added to `HANDLERS` is covered on the
line that registers it. Put a backend that drives this machine into an appspace that declares
`local_only:` — the alternative is what this replaced, where two routes guarded themselves and
twelve that spawn processes did not.

## Remote imports

**`deno.json`'s import map does not apply on Val Town.** Project files are served from `esm.town`
over https, and a bare specifier like `@std/yaml` resolves locally and then fails in production. The
`@std/assert` and `@std/path` entries in `deno.json` are unused; do not take them as a precedent.

An inline `https:` specifier resolves in both places, but `deno lint`'s `no-import-prefix` rejects
it. So every remote dependency under `backends/` is a pinned URL in a `const`, loaded with
`import(THAT_CONST)`. The indirection also keeps `deno check` from resolving URLs it need not fetch.

Use `https://esm.sh` for anything that is not a Val Town standard-library val, pinned to a version,
per `_other/docs/vt.md`. JSR packages go through it as `https://esm.sh/jsr/@scope/name@version`.
