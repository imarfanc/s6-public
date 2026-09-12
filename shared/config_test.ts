import { assertEquals } from "@std/assert";
import { config } from "./config.ts";

Deno.test("frontend kmtrigger templates keep name and path placeholders", () => {
  const { kmtriggerFile, kmtriggerFolder } = config.frontend;
  for (const template of [kmtriggerFile, kmtriggerFolder]) {
    assertEquals(template.startsWith("kmtrigger://macro="), true);
    assertEquals(template.includes("{name}"), true);
    assertEquals(template.includes("{path}"), true);
  }
});

Deno.test("frontend.mobileQuery matches the stylesheet breakpoint", async () => {
  const html = await Deno.readTextFile(new URL("../frontends/index.html", import.meta.url));
  const queries = [...html.matchAll(/@media\s*(\([^)]+\))/g)].map((match) => match[1]);

  // The contract is that the script's breakpoint exists in the stylesheet, not
  // that it is the only `max-width` query there — an unrelated one is allowed
  // to have its own width.
  assertEquals(
    queries.filter((query) => query === config.frontend.mobileQuery).length,
    1,
    `no @media ${config.frontend.mobileQuery} in the stylesheet; ` +
      `max-width queries found: ${queries.filter((q) => q?.includes("max-width")).join(", ")}`,
  );
});
