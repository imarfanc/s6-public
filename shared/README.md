# shared

Parsers and helpers used by backends and the gallery. The frontend never sees TypeScript; it loads
`/shared/config.js`, `/shared/store.js`, and `/shared/db.js` from `frontends/shared/` (config.js is
generated from `config.ts` by `routes/static.ts`).

- `config.ts` — app name, port, `dbPrefix`, paths, session cookie, and shell defaults. Change a
  value here rather than in the callers. Appspace passwords live in environment variables named from
  `password_env:` in `apps/sections-metadata.yaml`, not here. `_other/tools` does not import this
  file.
- `app-yaml.ts` — the only YAML reader, a deliberate small subset for hand-written `app.yaml`.
- `app-sql.ts` — statement splitting, `{token}` expansion, named queries. Pure text, no driver.
  Tokens expand to `<store>_<generation>_table`; the migrations table is `<dbPrefix>_migrations`.

`dbPrefix` (`s6`) names local storage files under `_other/data/<dbPrefix>/` and that migrations
table. See `backends/README.md`.
