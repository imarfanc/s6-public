import { assertEquals } from "@std/assert";
import { runInNewContext } from "node:vm";

const source = await Deno.readTextFile(new URL("../web/poem-audio.js", import.meta.url));

function browser(records: Map<string, Blob>, unavailable = false) {
  let calls = 0;
  const context = {
    window: {} as {
      PoemAudio: {
        audioFor: (text: string, language?: string, isCurrent?: () => boolean) => Promise<Blob>;
      };
    },
    Blob,
    AbortSignal,
    setTimeout,
    clearTimeout,
    fetch: () => {
      calls++;
      return Promise.resolve(new Response(new Blob(["audio"], { type: "audio/mpeg" })));
    },
    indexedDB: {
      open() {
        if (unavailable) throw new Error("Storage disabled");
        const request: any = {};
        queueMicrotask(() => {
          request.result = {
            close() {},
            transaction() {
              const transaction: any = {};
              transaction.objectStore = () => ({
                get(key: string) {
                  const read = { result: records.get(key) };
                  queueMicrotask(() => transaction.oncomplete());
                  return read;
                },
                put(blob: Blob, key: string) {
                  records.set(key, blob);
                  queueMicrotask(() => transaction.oncomplete());
                  return {};
                },
              });
              return transaction;
            },
          };
          request.onsuccess();
        });
        return request;
      },
    },
  };
  runInNewContext(source, context);
  return { api: context.window.PoemAudio, calls: () => calls };
}

Deno.test("poem audio persists across pages and keys by text", async () => {
  const records = new Map<string, Blob>();
  const first = browser(records);
  await first.api.audioFor("First couplet");
  await first.api.audioFor("First couplet");
  assertEquals(first.calls(), 1);
  const next = browser(records);
  await next.api.audioFor("First couplet");
  assertEquals(next.calls(), 0);
  await next.api.audioFor("Edited couplet");
  assertEquals(next.calls(), 1);
});
Deno.test("poem audio deduplicates requests and keeps memory fallback", async () => {
  const page = browser(new Map(), true);
  await Promise.all([page.api.audioFor("same"), page.api.audioFor("same")]);
  await page.api.audioFor("same");
  assertEquals(page.calls(), 1);
});
Deno.test("superseded queued passages do not call provider", async () => {
  const page = browser(new Map());
  const first = page.api.audioFor("first");
  const stale = page.api.audioFor("stale", "en", () => false).catch(() => null);
  const last = page.api.audioFor("last");
  await Promise.all([first, stale, last]);
  assertEquals(page.calls(), 2);
});

Deno.test("Urdu and Punjabi audio have separate persistent cache entries", async () => {
  const records = new Map<string, Blob>();
  const page = browser(records);
  await page.api.audioFor("shared text", "ur");
  await page.api.audioFor("shared text", "pa");
  assertEquals(page.calls(), 2);
  const reloaded = browser(records);
  await reloaded.api.audioFor("shared text", "ur");
  await reloaded.api.audioFor("shared text", "pa");
  assertEquals(reloaded.calls(), 0);
});
