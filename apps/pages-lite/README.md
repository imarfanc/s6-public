# Pages Lite

A small, read-only file library inspired by htmlpages-V8. Uses native HTML, JavaScript modules, and
modern CSS (cascade layers, light-dark colors, fluid sizing, and responsive grids). No framework,
build step, database, or external dependencies.

Open `/apps/pages-lite/` in the existing repository server, or choose **Pages Lite** under
**Examples → tools**.

Add `.html`, `.htm`, or `.md` files to `data/`, including subfolders, then click **Refresh files**.
Files are discovered through the platform's filesystem/Val Town adapter. No file manifest is needed.
The four bundled examples are two HTML pages and two Markdown notes.

Search filenames, filter by type, and switch between preview and source. The URL hash remembers the
selected file. Edit documents on disk; this app does not write or delete files.

Markdown supports headings, paragraphs, ordered/unordered lists, emphasis, inline/fenced code,
blockquotes, rules, and HTTP(S) links. It is a small subset, not full CommonMark; raw HTML is
escaped. HTML previews permit scripts inside an opaque-origin sandbox, without parent-page access.
HTML files should be self-contained: relative images, stylesheets, scripts, and cross-file links are
not resolved from the data folder. Markdown previews use the same sandbox.
