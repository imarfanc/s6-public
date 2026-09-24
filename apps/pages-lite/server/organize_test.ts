import { assertEquals } from "@std/assert";
import { compareEntries, groupKey } from "../web/organize.js";

Deno.test("Pages Lite sorting handles numeric names, ties, types, and unseen files", () => {
  const names = ["z/page10.html", "a/page2.md", "b/page2.html"];
  const sorted = (mode: string) =>
    names.map((name) => ({ name }))
      .sort(compareEntries(mode, { "z/page10.html": 100 })).map(({ name }) => name);
  assertEquals(sorted("name"), ["b/page2.html", "a/page2.md", "z/page10.html"]);
  assertEquals(sorted("name-desc"), [...sorted("name")].reverse());
  assertEquals(sorted("recent")[0], "z/page10.html");
  assertEquals(sorted("type"), ["b/page2.html", "z/page10.html", "a/page2.md"]);
  assertEquals(sorted("folder"), ["a/page2.md", "b/page2.html", "z/page10.html"]);
});

Deno.test("Pages Lite groups recent opens by local calendar dates", () => {
  const now = +new Date(2026, 8, 24, 12);
  const group = (day: number) =>
    groupKey("a.md", "recent", { "a.md": +new Date(2026, 8, day, 1) }, now);
  assertEquals(group(24), "Today");
  assertEquals(group(23), "Yesterday");
  assertEquals(group(20), "Previous 7 days");
  assertEquals(group(1), "Earlier");
  assertEquals(groupKey("a.md", "recent", {}, now), "Never opened");
  assertEquals(groupKey("notes/a.md", "folder"), "notes");
  assertEquals(groupKey("a.htm", "type"), "HTML");
  assertEquals(groupKey("notes/apple.md", "initial"), "A");
});
