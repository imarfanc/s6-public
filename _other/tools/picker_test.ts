import { assertEquals } from "@std/assert";
import { frameUpdate, groupedRows, menuWindow } from "./picker.ts";
import { screen } from "./style.ts";

Deno.test("picker paints initially, then patches changed rows without clearing screen", () => {
  assertEquals(frameUpdate(undefined, ["title", "a", "b"]), `${screen.clear}title\na\nb`);
  assertEquals(
    frameUpdate(["title", "a", "b"], ["title", "b", "a"]),
    `${screen.position(2)}${screen.clearLine}b${screen.position(3)}${screen.clearLine}a`,
  );
  assertEquals(frameUpdate(["same"], ["same"]), "");
});

Deno.test("picker erases shortened and removed rows; resize permits a fresh frame", () => {
  assertEquals(
    frameUpdate(["long label", "old footer"], ["short"]),
    `${screen.position(1)}${screen.clearLine}short${screen.position(2)}${screen.clearLine}`,
  );
  assertEquals(frameUpdate(undefined, ["resized"]), `${screen.clear}resized`);
});

Deno.test("grouped menu preserves headings, selection, and mouse row identities while scrolling", () => {
  const choices = Array.from(
    { length: 12 },
    (_, i) => ({ name: String(i), description: "", group: i < 6 ? "Run" : "Check" }),
  );
  const rows = groupedRows(choices);
  assertEquals(rows.filter((row) => row.choice === undefined).map((row) => row.group), [
    "Run",
    "Check",
  ]);
  let top = 0;
  for (const selected of [0, 5, 6, 11, 7, 0]) {
    const window = menuWindow(rows, selected, top, 4);
    top = window.top;
    assertEquals(window.visible.length <= 4, true);
    assertEquals(window.visible[0]?.choice, undefined);
    assertEquals(window.visible.some((row) => row.choice === selected), true);
  }
});
