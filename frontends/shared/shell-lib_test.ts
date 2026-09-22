import { assertEquals } from "@std/assert";
import {
  buildHistoryTree,
  childLabel,
  isLightBackground,
  matchesSearch,
  nextIn,
  parseRgb,
  pathKey,
  rememberRecent,
  spriteId,
} from "./shell-lib.js";

/** The threshold `shell.js` passes in, from `LIGHT_TONE_THRESHOLD`. */
const LIGHT = 0.55;

function app(fields: Record<string, unknown> = {}) {
  return { name: "Todo", description: "", path: "26.9/todo2", tags: [], ...fields };
}

Deno.test("spriteId turns an Iconify name into its sprite id", () => {
  assertEquals(spriteId("lucide:house"), "lucide--house");
  assertEquals(spriteId("thesvg-color:meta"), "thesvg-color--meta");
});

Deno.test("spriteId replaces everything a CSS selector could not carry", () => {
  assertEquals(spriteId("some icon/name.2"), "some-icon-name-2");
});

Deno.test("spriteId rewrites only the first colon", () => {
  assertEquals(spriteId("a:b:c"), "a--b-c");
});

Deno.test("childLabel drops the folder and the extension", () => {
  assertEquals(childLabel("editor.html"), "editor");
  assertEquals(childLabel("pages/editor.html"), "editor");
});

Deno.test("childLabel leaves an extensionless name alone", () => {
  assertEquals(childLabel("editor"), "editor");
});

Deno.test("pathKey joins an appspace and its sections", () => {
  assertEquals(pathKey("local_Apps", ["testing", "sqlite"]), "local_Apps/testing/sqlite");
});

Deno.test("pathKey drops empty parts rather than doubling the separator", () => {
  assertEquals(pathKey("local_Apps", []), "local_Apps");
  assertEquals(pathKey("", ["testing"]), "testing");
});

Deno.test("nextIn wraps at the end of the list", () => {
  const sizes = ["wide", "wide2", "collapsed"];
  assertEquals(nextIn(sizes, "wide"), "wide2");
  assertEquals(nextIn(sizes, "collapsed"), "wide");
});

Deno.test("nextIn starts at the first entry for an unknown current", () => {
  assertEquals(nextIn(["wide", "wide2", "collapsed"], "gone"), "wide");
});

Deno.test("parseRgb reads rgb and rgba", () => {
  assertEquals(parseRgb("rgb(18, 52, 86)"), { r: 18, g: 52, b: 86 });
  assertEquals(parseRgb("rgba(18, 52, 86, 0.5)"), { r: 18, g: 52, b: 86 });
});

Deno.test("parseRgb returns null for a form it does not read", () => {
  assertEquals(parseRgb("#123456"), null);
  assertEquals(parseRgb("transparent"), null);
});

Deno.test("isLightBackground separates white from black", () => {
  assertEquals(isLightBackground("rgb(255, 255, 255)", LIGHT), true);
  assertEquals(isLightBackground("rgb(0, 0, 0)", LIGHT), false);
});

Deno.test("isLightBackground weights green over blue", () => {
  // Same channel value: green weighs 0.587 and clears 0.55, blue weighs 0.114.
  assertEquals(isLightBackground("rgb(0, 255, 0)", LIGHT), true);
  assertEquals(isLightBackground("rgb(0, 0, 255)", LIGHT), false);
});

Deno.test("isLightBackground treats an unreadable colour as light", () => {
  assertEquals(isLightBackground("transparent", LIGHT), true);
});

Deno.test("matchesSearch keeps every app when the box is empty", () => {
  assertEquals(matchesSearch(app(), ""), true);
  assertEquals(matchesSearch(app(), "   "), true);
});

Deno.test("matchesSearch is case-insensitive across name, description and path", () => {
  assertEquals(matchesSearch(app(), "TODO"), true);
  assertEquals(matchesSearch(app({ description: "Keeps a list" }), "list"), true);
  assertEquals(matchesSearch(app(), "26.9"), true);
});

Deno.test("matchesSearch reads tags and children", () => {
  assertEquals(matchesSearch(app({ tags: ["sqlite"] }), "sqlite"), true);
  assertEquals(matchesSearch(app({ children: ["editor.html"] }), "editor"), true);
});

Deno.test("matchesSearch tolerates an app with no children key", () => {
  assertEquals(matchesSearch(app(), "nothing-like-this"), false);
});

Deno.test("rememberRecent puts the app first", () => {
  assertEquals(rememberRecent(["b", "c"], "a", 30), ["a", "b", "c"]);
});

Deno.test("rememberRecent moves a repeat open rather than duplicating it", () => {
  assertEquals(rememberRecent(["a", "b", "c"], "c", 30), ["c", "a", "b"]);
});

Deno.test("rememberRecent honours the limit", () => {
  assertEquals(rememberRecent(["b", "c", "d"], "a", 3), ["a", "b", "c"]);
});

/**
 * `matchesSearch` reads module state in `shell.js`, so extracting it turned the
 * search term into a second parameter — and `[].filter(matchesSearch)` then
 * hands it the array index, which has no `.trim()`. Two call sites were written
 * that way and threw on first render. A unit test cannot see a call site, so
 * this reads the caller, the way `build-manifest.ts` reads `router.ts`.
 */
Deno.test("shell.js never passes matchesSearch as a bare callback", async () => {
  const source = await Deno.readTextFile(new URL("../shell.js", import.meta.url));
  const body = source.slice(source.indexOf('from "/shared/shell-lib.js";'));
  const calls = [...body.matchAll(/matchesSearch(.?)/g)];
  assertEquals(calls.length > 0, true, "expected shell.js to call matchesSearch");
  for (const [, next] of calls) {
    assertEquals(next, "(", `matchesSearch used as a value, not called: "matchesSearch${next}"`);
  }
  for (const [, args] of body.matchAll(/matchesSearch\(([^)]*)\)/g)) {
    assertEquals(
      (args ?? "").includes(","),
      true,
      `matchesSearch(${args}) is missing the search argument`,
    );
  }
});

Deno.test("history advances at minute boundaries without duplicates", () => {
  const now = new Date(2026, 8, 22, 12).getTime();
  const minutes = [0, 4.99, 5, 9.99, 10, 29.99, 30];
  const apps = minutes.map((_, i) => ({ id: String(i) }));
  const opened = Object.fromEntries(minutes.map((age, i) => [String(i), now - age * 60000]));
  const nodes = buildHistoryTree(apps, opened, now);
  assertEquals(nodes.map((node) => node.label), ["Today"]);
  assertEquals(nodes[0]!.children.map((node) => node.apps.map((app) => app.id)), [
    ["0", "1"],
    ["2", "3"],
    ["4", "5"],
    ["6"],
  ]);
  assertEquals(
    buildHistoryTree([{ id: "0" }], { "0": now }, now + 5 * 60000)[0]!
      .children[0]!.id,
    "recent:10m",
  );
});

Deno.test("history uses calendar midnight and preserves old undated history", () => {
  const now = new Date(2026, 8, 22, 0, 2).getTime();
  const days = [1, 2, 3, 4, 7, 8, 30, 31, 365, 366];
  const opened: Record<string, number> = { unknown: 0 };
  for (const day of days) opened[String(day)] = new Date(2026, 8, 22 - day, 23, 59).getTime();
  const apps = Object.keys(opened).map((id) => ({ id }));
  const nodes = buildHistoryTree(apps, opened, now);
  assertEquals(nodes.map((node) => node.label), [
    "Yesterday",
    "Last 3 days",
    "Last week",
    "Last month",
    "Last year",
    "Older",
    "Unknown date",
  ]);
  assertEquals(nodes.map((node) => node.apps.map((app) => app.id)), [
    ["1"],
    ["2", "3"],
    ["4", "7"],
    ["8", "30"],
    ["31", "365"],
    ["366"],
    ["unknown"],
  ]);
  assertEquals(buildHistoryTree([{ id: "unopened" }], opened, now), []);
});
