/**
 * The parts of the gallery shell that are only data.
 *
 * `shell.js` is one module against a live DOM, so none of it could be run in a
 * test. These functions touch no document, no storage and no module state —
 * they take arguments and return values — which is the whole reason they live
 * in their own file. `shell-lib_test.ts` is the point of the split.
 *
 * Nothing here may import `/shared/config.js`: config is served only over HTTP
 * and a test has no server. Callers pass the tunable in.
 */

/** `lucide:house` is stored in the sprite as `lucide--house`. */
export function spriteId(name) {
  return name.replace(":", "--").replace(/[^a-z0-9-]+/gi, "-");
}

/** `editor.html` reads better as `editor` once it is under its app. */
export function childLabel(file) {
  return file.split("/").pop().replace(/\.[^.]+$/, "");
}

/** The tree key for an appspace and a section path. Empty parts drop out. */
export function pathKey(appspace, sections) {
  return [appspace, ...sections].filter(Boolean).join("/");
}

/**
 * The entry after `current`, wrapping — and the first one if `current` is not
 * in the list, which is how every cycling key starts from cold.
 */
export function nextIn(list, current) {
  return list[(list.indexOf(current) + 1) % list.length];
}

/** The channels of an `rgb()` or `rgba()` string, or null for anything else. */
export function parseRgb(color) {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return match ? { r: +match[1], g: +match[2], b: +match[3] } : null;
}

/**
 * Whether a preview background is light enough to need dark chrome over it.
 * A colour that will not parse counts as light, because the frame starts white.
 */
export function isLightBackground(color, threshold) {
  const rgb = parseRgb(color);
  if (!rgb) return true;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 > threshold;
}

/** Every field the sidebar search looks at, as one lowercase haystack. */
export function matchesSearch(app, search) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [app.name, app.description, app.path, ...app.tags, ...(app.children ?? [])]
    .join(" ").toLowerCase().includes(needle);
}

/** `id` to the front of "Recently opened", once, within the limit. */
export function rememberRecent(recent, id, limit) {
  return [id, ...recent.filter((entry) => entry !== id)].slice(0, limit);
}
