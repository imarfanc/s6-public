# Pages Lite

A small, read-only file library inspired by htmlpages-V8. Uses native HTML, JavaScript modules, and
modern CSS (cascade layers, light-dark colors, fluid sizing, and responsive grids). No framework,
build step, database, or external dependencies.

Open `/apps/pages-lite/` in the existing repository server, or choose **Pages Lite** under
**Examples → tools**.

Add `.html`, `.htm`, `.md`, `.toml`, or `.json` files to `data/`, including subfolders, then click
**Refresh files**. Files are discovered through the platform's filesystem/Val Town adapter. No file
manifest is needed. The four bundled examples are two HTML pages and two Markdown notes.

Search filenames, filter by type, and switch between preview and source. The URL hash remembers the
selected file. Edit documents on disk; this app does not write or delete files.

Use **Open standalone** beside Preview and Source to open any supported file in a new tab. Markdown
is rendered as a document; JSON and TOML use code highlighting and a Copy button, matching the grid
reader. HTML opens directly at `/apps/pages-lite/data/<filename>.html`, without the reader wrapper.
Embedded HTML previews still use an isolated sandbox.

Markdown supports headings, paragraphs, ordered/unordered lists, emphasis, inline/fenced code,
blockquotes, rules, and HTTP(S) links. It is a small subset, not full CommonMark; raw HTML is
escaped. HTML previews permit scripts inside an opaque-origin sandbox, without parent-page access.
HTML files should be self-contained: relative images, stylesheets, scripts, and cross-file links are
not resolved from the data folder. Markdown previews use the same sandbox.

TOML and JSON previews display escaped, preformatted text without parsing or executing it. Source
shows the original contents, including any invalid syntax.

## Grid frontend

Choose the **grid** child under Pages Lite, or open `/apps/pages-lite/grid.html`. This alternate
frontend uses the same data folder and API as the default list view. It follows the Pages Grid
frontend in `s6-local`, with preview cards, filename search, optional folder grouping, and a choice
of a dialog or standalone reader. Grouping and opening preferences are saved in the browser.

Thumbnails disable scripts. Full HTML documents use an opaque-origin sandbox with scripts enabled.
The grid reader renders escaped Markdown, TOML, and JSON with code highlighting and copy buttons.
Its renderer lives in `web/grid-markdown.js`; the default frontend keeps `web/markdown.js`.
