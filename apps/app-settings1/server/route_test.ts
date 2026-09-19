import { assertEquals } from "@std/assert";
import { handleAppSettings } from "./route.ts";
import { chromeValue, setChromeValue } from "./settings.ts";
import { handleRequest } from "../../../backends/routes/router.ts";

Deno.test("Chrome edit preserves unrelated preferences and does not infer missing values", () => {
  assertEquals(chromeValue({}), null);
  const data = { browser: { confirm_to_quit: true, other: 42 }, profiles: ["keep"] };
  assertEquals(setChromeValue(data), {
    browser: { confirm_to_quit: false, other: 42 },
    profiles: ["keep"],
  });
  assertEquals(chromeValue(data), false);
});
Deno.test("settings route only accepts allowlisted actions with correct methods", async () => {
  let calls = 0;
  const run = () => {
    calls++;
    return Promise.resolve({
      app: "chrome" as const,
      matches: true,
      current: "Disabled",
      backup: null,
      note: "",
    });
  };
  for (
    const [path, method, status] of [
      ["chrome/apply", "GET", 405],
      ["unknown/apply", "POST", 404],
      ["chrome/verify", "GET", 200],
      ["keyboard-maestro/apply", "POST", 200],
    ]
  ) {
    const response = (await handleAppSettings(
      new Request(`http://localhost/api/apps/app-settings1/${path}`, { method: String(method) }),
      run,
    ))!;
    assertEquals(response.status, status);
    await response.body?.cancel();
  }
  assertEquals(calls, 2);
});
Deno.test("settings API inherits local-only and cross-origin gates", async () => {
  for (
    const request of [
      new Request("https://example.com/api/apps/app-settings1/chrome/apply", { method: "POST" }),
      new Request("http://localhost:8893/api/apps/app-settings1/chrome/apply", {
        method: "POST",
        headers: { origin: "https://example.com" },
      }),
    ]
  ) {
    const response = await handleRequest(request);
    assertEquals(response.status, 403);
    await response.body?.cancel();
  }
});
