# frontends

The gallery shell. No build step — `index.html` is CSS and markup; `shell.js` is the one ES module.
Both are edited in place. `shared/store.js` and `shared/db.js` are what apps import;
`shared/icons.svg` is the vendored Iconify sprite (`deno task icons`).

`shared/shell-lib.js` is the shell's own pure half: id and label formatting, the search predicate,
the cycling and "recently opened" list maths, and the preview-luminance test. `shell.js` runs
against a live DOM and cannot be tested; these take arguments and return values, so
`shared/shell-lib_test.ts` covers them under `deno task check`. A tunable stays a `const` in
`shell.js` and is passed in — `shell-lib.js` must not import `/shared/config.js`, which exists only
over HTTP. New shell logic with no DOM in it belongs here.

The shell loads `/shared/config.js` (generated from `shared/config.ts`). Defaults such as
`mobileQuery`, icon names, the `localStorage` key, and the Keyboard Maestro tooltip URLs live there.
A locked appspace is visible in the switcher and prompts for its password before the tree is
selected or an app opens.

## App colors and the sidebar

The shell copies live styles out of the preview iframe onto its own chrome:

- iframe `body`/`html` `background-color` + `background-image` → sidebar glass, `--preview-bg`
- iframe `:root --accent` → icon tint, selected row, `--app-color`
- background luminance → `body[data-preview-tone="light|dark"]`, which reskins the whole shell

When you change an app's look, do all three: `--accent` on `:root`, the same hex in `app.yaml`
`color:`, and page backgrounds on `body`. An inner card is invisible to the sync.

An app that changes its background at runtime should
`parent.postMessage({ type: "gallery-preview-bg-changed" }, "*")`. Same-origin only; fails silently
otherwise.

## Markup

The static shell bottoms out around 8 levels and is already flat. Do not "simplify" it by trading
wrapper elements for grid/subgrid placement — that moves complexity out of markup, where it is
visible, and into CSS, where it is not. Specifically, leave these alone:

- `#root-copy`, `#preview-message` — one wrapper each, cheaper than the grid rules that would
  replace them.
- `#sidebar-header` — `#sidebar[data-width="collapsed"] > *` hides its direct children, and the
  900px override re-shows them; flattening changes what that selector means.
- `.tree-group` > `.tree-children` — collapse is `children.hidden`; search filtering reads
  `dataset.hasMatches` and `childElementCount`.
- `.app-row` wrapping a button plus an external `<a>` — two separate controls, deliberate.
- `svg.icon > use` — sprite requirement. The sprite is fetched and inlined into `#icon-sprite`
  because browsers will not follow `<use>` into an external file.
- `#app` — `body` also holds the sprite, backdrop, and toggle.

Every static control has an id; generated nodes derive ids from the app or section path. Keep that.

### Tuning blocks

Two commented blocks hold the values worth changing: CSS custom properties at the top of `:root`,
and named constants at the top of the module. Rules and code are written in terms of them, so change
the dial rather than the literal, and put a new tunable in the block rather than inline.

Two of them are contracts, not preferences:

- `frontend.mobileQuery` in `shared/config.ts` must equal the `@media (max-width: 900px)` breakpoint
  in the stylesheet. `shared/config_test.ts` fails if they drift. It cannot be a custom property —
  CSS variables are not allowed in media queries.
- the tree's bottom padding is `calc(var(--toggle-size) + var(--toggle-inset) * 2)`, so the last row
  clears the floating toggle at any size. Do not re-hardcode it.

`DEFAULT_*_ICON` names live in `shared/config.ts` and must exist in the sprite; run
`deno task icons` after changing one.

`renderTree()` rebuilds the sidebar wholesale, and that is the intended design for anything that
changes _what_ the tree contains — search, view switches, appspace switches, opening an app. It
costs ~4ms at 50 apps. Do not add incremental diffing.

Collapsing is the exception, and it is handled by `syncCollapsed()` instead. Expanding or collapsing
cannot change anything a re-render would compute differently — same labels, same counts, same
ordering, same app rows — so it flips `aria-expanded` and `.tree-children.hidden` in place on the
nodes already on screen. That is not an optimisation:

- rebuilding destroys the button the user just activated, dropping keyboard focus to `<body>`. Tab
  then restarts from the top of the page, so a keyboard user cannot move past a section they just
  collapsed.
- the chevron's `transition: transform .2s ease` can never run if the element is replaced mid-flip.
  On the rebuild path that rule was dead CSS.

So: state changes that alter tree _contents_ → `renderTree()`. State changes that only alter
_disclosure_ → `syncCollapsed()`. `.tree-group` carries `data-section-id` so the second one can find
its nodes, and `data-search-aware` because the app tree force-expands during a search while the
updated tree does not.

## Theme

`color-scheme: light dark` plus `light-dark()` tokens on `:root`, overridden by
`body[data-preview-tone]`. Do not add a second theme mechanism: no class toggles, no JS theme state,
no media-query duplicates beyond the one dark `--glass-bg` override.

## History

History groups each app by its latest opening, with local-calendar Today and Yesterday boundaries.
Today has buckets for under 5 minutes, 5 to 10 minutes, 10 to 30 minutes, and Earlier today. Older
buckets cover days 2–3, 4–7, 8–30, 31–365, and Older. Empty buckets are hidden. The view refreshes
every 30 seconds while visible and when returning to the page. Existing browser history without
timestamps remains under Unknown date until reopened.

The `d` shortcut cycles indentation for the active sidebar tab; each tab remembers its own value.
History uses the same group disclosure controls and `x` shortcut as the other views.

`/api/shell-history` reads gallery-wide history, restricted to accessible appspaces. A PUT to
`/api/shell-history/<app path>` merges that app's last-opened timestamp. Each app has its own blob
under `shell-history/`; storage uses the existing adapter, local disk on localhost and Val Town
blobs when hosted. History is shared between visitors to the same gallery, not a personal account.
Separate local servers do not sync with one another. Browser state caches timestamps and queues
failed writes for retry. A sync failure appears in History. Grants and local-only rules also apply
to history reads and writes.
