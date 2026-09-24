import { assertEquals } from "@std/assert";
import { handlePagesLite } from "./route.ts";

const request = (query = "", method = "GET") =>
  new Request(`http://localhost/api/apps/pages-lite/files${query}`, { method });

Deno.test("Pages Lite discovers and reads the checkout's documents", async () => {
  const root = new URL("../data/", import.meta.url);
  const expected: string[] = [];
  async function walk(dir: URL, prefix = "") {
    for await (const item of Deno.readDir(dir)) {
      if (item.name.startsWith(".")) continue;
      const name = prefix + item.name;
      if (item.isDirectory) {
        await walk(new URL(encodeURIComponent(item.name) + "/", dir), name + "/");
      } else if (item.isFile && /\.(html?|md|toml|json)$/i.test(name)) expected.push(name);
    }
  }
  await walk(root);
  const response = await handlePagesLite(request());
  assertEquals(response!.status, 200);
  const { files } = await response!.json();
  assertEquals(files, expected.sort((a, b) => a.localeCompare(b)));
  for (const name of files) {
    const document = await handlePagesLite(request(`?file=${encodeURIComponent(name)}`));
    assertEquals(document!.status, 200);
    assertEquals(
      (await document!.json()).content,
      await Deno.readTextFile(new URL(name.split("/").map(encodeURIComponent).join("/"), root)),
    );
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

Deno.test("Pages Lite TTS validates requests before calling the provider", async () => {
  const url = "http://localhost/api/apps/pages-lite/tts";
  const method = await handlePagesLite(new Request(url));
  assertEquals(method!.status, 405);
  await method!.body?.cancel();
  for (
    const body of ["{", "null", "{}", '{"text":3}', JSON.stringify({ text: "x".repeat(1001) })]
  ) {
    const result = await handlePagesLite(new Request(url, { method: "POST", body }));
    assertEquals(result!.status, 400);
    await result!.body?.cancel();
  }
});

Deno.test("Pages Lite TTS keeps credentials server-side and returns provider audio", async () => {
  const previous = Deno.env.get("INWORLD_API_KEY");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    Deno.env.set("INWORLD_API_KEY", "test-key");
    globalThis.fetch = (url, options) => {
      calls++;
      assertEquals(url, "https://api.inworld.ai/tts/v1/voice");
      assertEquals(new Headers(options?.headers).get("Authorization"), "Basic test-key");
      const body = JSON.parse(String(options?.body));
      assertEquals(body.text, "A single couplet.");
      assertEquals(body.language, "en");
      return Promise.resolve(Response.json({ audioContent: btoa("test-audio") }));
    };
    const response = await handlePagesLite(
      new Request("http://localhost/api/apps/pages-lite/tts", {
        method: "POST",
        body: JSON.stringify({ text: " A single couplet. " }),
      }),
    );
    assertEquals(response!.status, 200);
    assertEquals(response!.headers.get("content-type"), "audio/mpeg");
    assertEquals(await response!.text(), "test-audio");
    assertEquals(calls, 1);
    Deno.env.delete("INWORLD_API_KEY");
    const missing = await handlePagesLite(
      new Request("http://localhost/api/apps/pages-lite/tts", {
        method: "POST",
        body: JSON.stringify({ text: "A single couplet." }),
      }),
    );
    assertEquals(missing!.status, 503);
    await missing!.body?.cancel();
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) Deno.env.delete("INWORLD_API_KEY");
    else Deno.env.set("INWORLD_API_KEY", previous);
  }
});

Deno.test("Pages Lite forwards Urdu and Punjabi without relabeling them as English", async () => {
  const previous = Deno.env.get("INWORLD_API_KEY");
  const originalFetch = globalThis.fetch;
  const endpoint = "http://localhost/api/apps/pages-lite/tts";
  try {
    Deno.env.set("INWORLD_API_KEY", "test-key");
    for (const [language, text] of [["ur", "عظیم راہ دشوار نہیں"], ["pa", "وڈی راہ اوکھی نہیں"]]) {
      globalThis.fetch = (_url, options) => {
        const body = JSON.parse(String(options?.body));
        assertEquals(body.language, language);
        assertEquals(body.text, text);
        return Promise.resolve(Response.json({ audioContent: btoa("audio") }));
      };
      const response = await handlePagesLite(
        new Request(endpoint, {
          method: "POST",
          body: JSON.stringify({ text, language }),
        }),
      );
      assertEquals(response!.status, 200);
      await response!.body?.cancel();
    }
    for (const language of ["unknown", 3, {}, "pa-Arab"]) {
      const response = await handlePagesLite(
        new Request(endpoint, {
          method: "POST",
          body: JSON.stringify({ text: "test", language }),
        }),
      );
      assertEquals(response!.status, 400);
      await response!.body?.cancel();
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) Deno.env.delete("INWORLD_API_KEY");
    else Deno.env.set("INWORLD_API_KEY", previous);
  }
});

Deno.test("Pages Lite serves standalone GET and HEAD and rejects unsafe paths", async () => {
  const inventory = await handlePagesLite(request());
  const { files } = await inventory!.json();
  for (const name of files.slice(0, 2)) {
    const url = `http://localhost/apps/pages-lite/data/${
      name.split("/").map(encodeURIComponent).join("/")
    }`;
    const get = await handlePagesLite(new Request(url));
    assertEquals(get!.status, 200);
    await get!.body?.cancel();
    const head = await handlePagesLite(new Request(url, { method: "HEAD" }));
    assertEquals(head!.status, 200);
    assertEquals(await head!.text(), "");
  }
  for (
    const [path, status] of [["%2e%2e%2fapp.yaml", 404], ["%ZZ.html", 400], [".hidden.html", 404], [
      "missing.html",
      404,
    ]] as const
  ) {
    const response = await handlePagesLite(
      new Request(`http://localhost/apps/pages-lite/data/${path}`),
    );
    assertEquals(response!.status, status);
    await response!.body?.cancel();
  }
});
