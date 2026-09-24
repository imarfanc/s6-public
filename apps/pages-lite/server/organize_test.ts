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
  assertEquals(group(24), "Overnight");
  assertEquals(group(23), "Yesterday");
  assertEquals(group(20), "2–7 days ago");
  assertEquals(group(1), "8–30 days ago");
  assertEquals(groupKey("a.md", "recent", {}, now), "Never opened");
  assertEquals(groupKey("notes/a.md", "folder"), "notes");
  assertEquals(groupKey("a.htm", "type"), "HTML");
  assertEquals(groupKey("notes/apple.md", "initial"), "A");
});

Deno.test("Pages Lite and shell agree at hybrid boundaries", async () => {
  const { buildHistoryTree } = await import("../../../frontends/shared/shell-lib.js");
  const now = +new Date(2026, 8, 24, 23);
  const times = [0, 4.99, 5, 9.99, 10, 29.99, 30].map((age) => now - age * 60000);
  times.push(...[0, 5, 6, 11, 12, 17, 18].map((hour) => +new Date(2026, 8, 24, hour)));
  times.push(...[1, 2, 7, 8, 30, 31].map((day) => +new Date(2026, 8, 24 - day, 23)));
  for (const time of times) {
    const tree = buildHistoryTree([{ id: "a" }], { a: time }, now);
    const bucket = tree[0]!.children[0] || tree[0]!;
    assertEquals(groupKey("a", "recent", { a: time }, now), bucket.label);
  }
  for (
    const [hour, label] of [[0, "Overnight"], [6, "This morning"], [12, "This afternoon"], [
      18,
      "This evening",
    ]] as const
  ) {
    assertEquals(groupKey("a", "recent", { a: +new Date(2026, 8, 24, hour) }, now), label);
  }
});
