(function () {
  "use strict";

  const TTS_API = "/api/apps/pages-lite/tts";
  const memory = new Map();
  let queue = Promise.resolve();
  // Bump this when the model, voice, or audio settings in server/ change.
  const CACHE_VERSION = "inworld-tts-2-default-voice-v1";
  const pending = new Map();
  let databasePromise;

  function database() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve) => {
        let settled = false;
        const finish = (db) => {
          if (settled) { if (db) db.close(); return; }
          settled = true;
          clearTimeout(timer);
          resolve(db);
        };
        const timer = setTimeout(() => finish(null), 1500);
        try {
          const request = indexedDB.open("hsin-hsin-ming-audio", 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore("audio");
          };
          request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); databasePromise = null; };
            finish(db);
          };
          request.onerror = () => finish(null);
          request.onblocked = () => finish(null);
        } catch (_) { finish(null); }
      });
    }
    return databasePromise;
  }

  async function cachedAudio(key, blob) {
    const db = await database();
    if (!db) return null;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 1500);
      const finish = (value) => { clearTimeout(timer); resolve(value); };
      try {
        const transaction = db.transaction("audio", blob ? "readwrite" : "readonly");
        const store = transaction.objectStore("audio");
        const request = blob ? store.put(blob, key) : store.get(key);
        transaction.oncomplete = () => finish(blob || request.result || null);
        transaction.onerror = transaction.onabort = () => finish(null);
      } catch (_) { finish(null); }
    });
  }

  function audioFor(text, language = "en", isCurrent = () => true) {
    const key = JSON.stringify([CACHE_VERSION, language, text]);
    if (memory.has(key)) return Promise.resolve(memory.get(key));
    if (pending.has(key)) {
      const entry = pending.get(key);
      entry.interested.push(isCurrent);
      return entry.result;
    }
    const interested = [isCurrent];
    const result = queue.catch(() => {}).then(async () => {
      const saved = await cachedAudio(key);
      if (saved instanceof Blob && saved.size > 0) return saved;
      if (!interested.some(current => current())) throw new Error("Playback cancelled");
      const res = await fetch(TTS_API, {
        method: "POST",
        signal: AbortSignal.timeout(95000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      });
      if (!res.ok) {
        let msg = `Speech request failed (HTTP ${res.status})${res.statusText ? `: ${res.statusText}` : ""}`;
        try {
          const err = await res.json();
          if (err.error) msg = err.error;
        } catch (_) {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      if (!blob.size) throw new Error("The speech service returned empty audio");
      await cachedAudio(key, blob);
      memory.set(key, blob);
      return blob;
    });
    queue = result;
    pending.set(key, { result, interested });
    result.finally(() => pending.delete(key)).catch(() => {});
    return result;
  }

  window.PoemAudio = { audioFor };
})();
