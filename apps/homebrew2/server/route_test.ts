import { assertEquals } from "@std/assert";
import { handleHomebrew } from "./route.ts";

const request = (method = "GET") =>
  new Request("http://localhost/api/apps/homebrew2/installed", { method });

Deno.test("installed scan returns both lists including an empty list and disables caching", async () => {
  const data = { formulae: ["git", "python@3.13"], casks: [], checkedAt: "2026-09-13T12:00:00Z" };
  const response = (await handleHomebrew(request(), () => Promise.resolve(data)))!;
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(await response.json(), data);
});

Deno.test("scan failure is not reported as an empty installed list", async () => {
  const response = (await handleHomebrew(request(), () => {
    throw new Error("Homebrew unavailable");
  }))!;
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "Homebrew unavailable" });
});

Deno.test("unsupported methods and unrelated routes never run Homebrew", async () => {
  let called = false;
  const read = () => {
    called = true;
    return Promise.resolve({ formulae: [], casks: [], checkedAt: "" });
  };
  const response = (await handleHomebrew(request("POST"), read))!;
  assertEquals(response.status, 405);
  await response.body?.cancel();
  assertEquals(await handleHomebrew(new Request("http://localhost/api/unrelated"), read), null);
  assertEquals(called, false);
});
