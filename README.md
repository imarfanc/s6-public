# st6-public

Plain-HTML app gallery with a shared Deno backend. No frontend build step or framework.

## Run locally

Install Deno, then run:

```sh
cp .env.example .env
deno task dev
```

Open http://localhost:8893. The server binds to loopback by default.

## Starter app

`apps/todo1` contains a todo list with All, Active, and Completed filters. It uses the shared JSON
store and starts empty. The Examples appspace is public; anyone who can reach a hosted instance can
read and change its shared todo list.

Runtime data stays under `_other/data/st6_public/` and is ignored by Git.

## Development

- `deno task check` validates formatting, lint, types, tests, and the app manifest.
- `deno task manifest` rebuilds app discovery metadata.
- `deno task icons` regenerates the vendored icon sprite.
- Read `apps/README.md` to add apps and register optional app backends.

The shared backend also supports Val Town through `backends/main.ts`. This repo is based on s6-local
and contains no source-repository history or personal data.
