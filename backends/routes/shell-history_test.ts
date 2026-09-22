import { assertEquals, assertRejects } from "@std/assert";
import { historyStore } from "./shell-history.ts";
import { discover } from "./apps.ts";
import { requiredAppspace } from "../shared/auth.ts";
import { handleRequest } from "./router.ts";

Deno.test("history survives a new store instance and keeps the latest concurrent opening", async () => {
  const blobs = new Map<string, string>();
  const storage = {
    read: (key: string) => Promise.resolve(blobs.get(key) ?? null),
    write: (key: string, value: string) => {
      blobs.set(key, value);
      return Promise.resolve();
    },
  };
  const store = historyStore(storage);
  await Promise.all([store.remember("a", 20), store.remember("a", 10), store.remember("b", 15)]);
  await store.remember("a", 0);
  const restored = historyStore(storage);
  assertEquals(await restored.timestamp("a"), 20);
  assertEquals(await restored.timestamp("b"), 15);
  assertEquals(await restored.timestamp("missing"), null);
});

Deno.test("a failed history write can be retried", async () => {
  let fail = true;
  let saved: string | null = null;
  const store = historyStore({
    read: () => Promise.resolve(saved),
    write: (_key, value) => {
      if (fail) return Promise.reject(new Error("offline"));
      saved = value;
      return Promise.resolve();
    },
  });
  await assertRejects(() => store.remember("a", 20));
  fail = false;
  await store.remember("a", 20);
  assertEquals(await store.timestamp("a"), 20);
});

Deno.test("history app paths resolve to the existing appspace security gates", async () => {
  for (const app of (await discover()).apps) {
    const scope = await requiredAppspace(
      new Request(`http://localhost/api/shell-history/${app.path}`),
    );
    assertEquals(scope?.appspace, app.appspace);
    assertEquals(scope?.app?.id, app.id);
  }
});

Deno.test("history rejects foreign origins and unsupported methods", async () => {
  for (
    const [init, expected] of [
      [{ headers: { origin: "https://foreign.example" } }, 403],
      [{ method: "DELETE" }, 405],
    ] as [RequestInit, number][]
  ) {
    const response = await handleRequest(new Request("http://localhost/api/shell-history", init));
    assertEquals(response.status, expected);
    await response.body?.cancel();
  }
});
