import { assertEquals } from "@std/assert";
import { handlePagesLite } from "./route.ts";

const request = (query = "", method = "GET") =>
  new Request(`http://localhost/api/apps/pages-lite/files${query}`, { method });

Deno.test("Pages Lite discovers and reads four sample documents", async () => {
  const response = await handlePagesLite(request());
  const { files } = await response!.json();
  for (const name of ["garden.html", "color-study.html", "weekend-notes.md", "tiny-project.md"]) {
    assertEquals(files.includes(name), true);
    const document = await handlePagesLite(request(`?file=${name}`));
    assertEquals(document!.status, 200);
    assertEquals((await document!.json()).content.length > 0, true);
  }
});

Deno.test("Pages Lite rejects traversal, unknown files, and writes", async () => {
  for (const name of ["../app.yaml", "../../../.env", "missing.md"]) {
    const response = await handlePagesLite(request(`?file=${encodeURIComponent(name)}`));
    assertEquals(response!.status, 404);
    await response!.body?.cancel();
  }
  const response = await handlePagesLite(request("", "POST"));
  assertEquals(response!.status, 405);
  await response!.body?.cancel();
  assertEquals(await handlePagesLite(new Request("http://localhost/unrelated")), null);
});

Deno.test("Pages Lite serves standalone HTML and rejects other direct paths", async () => {
  const response = await handlePagesLite(
    new Request("http://localhost/apps/pages-lite/data/garden.html"),
  );
  assertEquals(response!.status, 200);
  assertEquals(response!.headers.get("content-type"), "text/html; charset=utf-8");
  assertEquals((await response!.text()).includes("The window garden"), true);
  for (const path of ["missing.html", "tiny-project.md", "%2e%2e%2fapp.yaml", "%ZZ.html"]) {
    const missing = await handlePagesLite(
      new Request(`http://localhost/apps/pages-lite/data/${path}`),
    );
    assertEquals(missing!.status, 404);
    await missing!.body?.cancel();
  }
});
