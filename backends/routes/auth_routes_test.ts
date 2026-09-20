import { assertEquals } from "@std/assert";
import { handleRequest } from "./router.ts";

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost:8893${path}`, init);
}

Deno.test("discovery exposes the public apps", async () => {
  const response = await handleRequest(request("/api/apps"));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.apps.map((app: { id: string }) => app.id), [
    "app-settings1",
    "homebrew2",
    "macos-installer-guide",
    "pages-lite",
    "todo1",
  ]);
  assertEquals(
    body.appspaces.map((space: { name: string; locked: boolean }) => ({
      name: space.name,
      locked: space.locked,
    })),
    [{ name: "Examples", locked: false }, { name: "macos1", locked: false }],
  );
  assertEquals(
    body.appspaces.some((space: Record<string, unknown>) =>
      "password_env" in space || "passwordEnv" in space
    ),
    false,
  );
});

Deno.test("gallery and app assets are public", async () => {
  for (
    const path of [
      "/",
      "/apps/todo1/",
      "/apps/app-settings1/",
      "/apps/app-settings1/app.js",
      "/apps/macos-installer-guide/",
      "/apps/todo1/index.html",
      "/shared/store.js",
      "/apps/homebrew2/",
      "/apps/homebrew2/index.html",
      "/apps/homebrew2/app.js",
      "/apps/homebrew2/style.css",
      "/apps/homebrew2/data/inventory.yaml",
    ]
  ) {
    const response = await handleRequest(request(path));
    assertEquals(response.status, 200, path);
    await response.body?.cancel();
  }
});

Deno.test("internal metadata and missing apps are not served", async () => {
  for (
    const path of [
      "/apps/sections-metadata.yaml",
      "/apps/_manifest.json",
      "/apps/_templates/app.template.yaml",
      "/apps/missing/",
      "/.env",
    ]
  ) {
    const response = await handleRequest(request(path));
    assertEquals(response.status, 404, path);
    await response.body?.cancel();
  }
});

Deno.test("cross-origin requests are refused before handlers", async () => {
  const response = await handleRequest(request("/api/apps", {
    headers: { origin: "https://attacker.example" },
  }));
  assertEquals(response.status, 403);
  assertEquals((await response.json()).error, "Cross-origin request");
});

Deno.test("same-origin and origin-less requests reach discovery", async () => {
  for (const headers of [new Headers({ origin: "http://localhost:8893" }), new Headers()]) {
    const response = await handleRequest(request("/api/apps", { headers }));
    assertEquals(response.status, 200);
    await response.body?.cancel();
  }
});

Deno.test("Homebrew API is local-only and rejects foreign origins", async () => {
  for (
    const request of [
      new Request("https://example.com/api/apps/homebrew2/installed"),
      new Request("http://localhost:8893/api/apps/homebrew2/installed", {
        headers: { origin: "https://attacker.example" },
      }),
    ]
  ) {
    const response = await handleRequest(request);
    assertEquals(response.status, 403);
    await response.body?.cancel();
  }
});
