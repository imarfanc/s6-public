import { assertEquals, assertStringIncludes } from "@std/assert";
import { searchPrompt } from "./ai-profiles.ts";
import { runAllSearch } from "./ai-search.ts";
import { handleAppSettings } from "./route.ts";
import { handleRequest } from "../../../backends/routes/router.ts";

Deno.test("search AI targets one profile and stops on errors or managed settings", () => {
  const prompt = searchPrompt("Work", "Profile 2");
  assertStringIncludes(prompt, 'named "Work", directory "Profile 2"');
  assertStringIncludes(prompt, "default address-bar search engine to DuckDuckGo");
  assertStringIncludes(prompt, "managed/locked setting");
  assertStringIncludes(prompt, "Do not retry");
  assertStringIncludes(prompt, "SAME profile on disk");
});
Deno.test("AI search is POST-only, dispatches separately and inherits local-only access", async () => {
  let calls = 0;
  const launch = () => {
    calls++;
    return Promise.resolve({ launched: true, message: "Started" });
  };
  for (const method of ["GET", "POST"]) {
    const response = (await handleAppSettings(
      new Request("http://localhost:8893/api/apps/app-settings1/chrome-search/ai-apply", {
        method,
      }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      launch,
    ))!;
    assertEquals(response.status, method === "GET" ? 405 : 200);
    await response.body?.cancel();
  }
  assertEquals(calls, 1);
  const response = await handleRequest(
    new Request("https://example.com/api/apps/app-settings1/chrome-search/ai-apply", {
      method: "POST",
    }),
  );
  assertEquals(response.status, 403);
  await response.body?.cancel();
});

Deno.test("all-profile search runs in sequence and stops on errors or handoffs", async () => {
  const profiles = [
    { name: "One", directory: "Default" },
    { name: "Two", directory: "Profile 1" },
    { name: "Three", directory: "Profile 2" },
  ];
  for (const status of ["error", "needs_user"]) {
    const visited: string[] = [];
    const result = await runAllSearch(profiles, (_name, directory) => {
      visited.push(directory);
      return Promise.resolve(visited.length === 1 ? "completed" : status);
    });
    assertEquals(visited, ["Default", "Profile 1"]);
    assertEquals(result.completed, ["Default"]);
    assertEquals(result.stopped, "Profile 1");
  }
  const result = await runAllSearch(profiles, () => Promise.resolve("completed"));
  assertEquals(result.completed, ["Default", "Profile 1", "Profile 2"]);
  assertEquals(result.stopped, null);
  assertStringIncludes(searchPrompt("One", "Default"), 'cua.getApp("Google Chrome")');
  assertStringIncludes(searchPrompt("One", "Default"), "do NOT claim it with browser getTab");
});
