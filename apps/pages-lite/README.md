# Pages Lite

A simple grid of HTML, Markdown, TOML, and JSON previews. Search by filename and click a card to
read the full page. Close the reader with Close or Escape.

Add `.html`, `.htm`, `.md`, `.toml`, or `.json` files under `data/`, including subfolders, then
click Refresh. Each checkout keeps its own files. Files are read through the shared platform; no
database or build step.

Markdown supports headings, paragraphs, lists, emphasis, links, quotes, and fenced code. Raw HTML in
Markdown is escaped. Grid previews have scripts disabled; the expanded HTML preview allows scripts
in an isolated sandbox without access to the app's origin.

The app opens in grid view at `/apps/pages-lite/`. List view remains available from the toolbar.

The grid view has a library rail on the left: All files, Recently opened, each folder (including
parents of nested folders), and each file type, with counts. The selected scope is kept in the URL
hash (`#folder/shopping`, `#type/md`, `#recent`), so it can be bookmarked and Back returns to the
previous scope. Search filters within the scope; press `/` to jump to it. On narrow screens the rail
becomes a row of scrolling chips.

Folder grouping and new-tab opening are enabled by default. Use the controls in the top bar to sort
by name, file type, folder, or recently opened, group by folder, type, name initial, or recent
activity, and open files in a new tab or a dialog reader; preferences are remembered in this
browser. The dialog also has an Open in new tab link. Standalone HTML links open the actual file
under `data/`; other formats use the reader. Standalone URLs can be bookmarked. Previews reload only
when a change reorders or regroups the grid.

Markdown fenced code blocks include a copy button and simple highlighting for strings, comments,
keywords, numbers, and shell variables. Add a language after the opening fence (for example `bash`
or `js`) to identify the block. Copy preserves the original code text.

TOML and JSON display as escaped, preformatted text in grid previews and both reader modes. Contents
are preserved without parsing, including any invalid syntax.

## Hsin Hsin Ming audio

The poem plays one selected couplet at a time. Device voices support English, Chinese, or both. The
optional Inworld English voice supports English, Urdu, and Punjabi using the same model and voice as
edu-words, through `POST /api/apps/pages-lite/tts`. Set `INWORLD_API_KEY` in the server environment
to enable it. The key stays on the server.

Generated MP3s are saved in IndexedDB by text, language, and model/voice version. Replaying or
changing speed reuses the recording. Requests run serially; repeated requests share pending work,
and superseded queued passages are skipped. A generation already in progress finishes and caches its
result, but cannot start stale playback. If browser storage is unavailable, a memory cache lasts
until the page closes. Bump `CACHE_VERSION` in `web/poem-audio.js` when changing provider settings.

Recent activity records opens in this browser, including list view. It is not a file modification
date. Grouping uses non-overlapping minute ranges under 30 minutes, then local-time evening,
afternoon, morning, and overnight groups for the rest of today. Older opens use Yesterday, 2–7 days
ago, 8–30 days ago, and Older, with Never opened last. Empty groups are hidden. Groups refresh every
30 seconds while visible and when returning to the page. Existing folder-group and open-mode
preferences are preserved.
