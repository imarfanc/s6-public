import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createProfile,
  inspectProfile,
  listProfiles,
  profileDirectory,
  profileName,
} from "./profiles.ts";
import { handleAppSettings } from "./route.ts";
import { handleRequest } from "../../../backends/routes/router.ts";

Deno.test("profile names reject paths and control characters; directory identity is stable", async () => {
  for (const name of ["", "../escape", "a/b", "a\\b", "a\nb", "a".repeat(61), null]) {
    assertThrows(() => profileName(name));
  }
  assertEquals(profileName(" Work "), "Work");
  assertEquals(await profileDirectory("Work"), await profileDirectory(" work "));
});
Deno.test("create seeds only a new profile, retries reuse it, verification requires Chrome registration", async () => {
  const root = await Deno.makeTempDir();
  try {
    const launched: string[] = [];
    const launch = (directory: string) => {
      launched.push(directory);
      return Promise.resolve();
    };
    const first = await createProfile(root, "Personal", launch);
    assertEquals(first.verified, false);
    assertEquals(first.exists, false);
    const directory = await profileDirectory("Personal");
    const prefs = JSON.parse(await Deno.readTextFile(`${root}/${directory}/Preferences`));
    assertEquals(prefs.profile, { name: "Personal", using_default_name: false });
    prefs.custom = { keep: 42 };
    await Deno.writeTextFile(`${root}/${directory}/Preferences`, JSON.stringify(prefs));
    await createProfile(root, "Personal", launch);
    assertEquals(launched, [directory, directory]);
    assertEquals(
      JSON.parse(await Deno.readTextFile(`${root}/${directory}/Preferences`)).custom.keep,
      42,
    );
    prefs.profile.name = "Your Chrome";
    await Deno.writeTextFile(`${root}/${directory}/Preferences`, JSON.stringify(prefs));
    const state = {
      profile: {
        info_cache: { [directory]: { name: "Personal", user_name: "private@example.com" } },
      },
      unrelated: 42,
    };
    await Deno.writeTextFile(`${root}/Local State`, JSON.stringify(state));
    const result = await createProfile(root, "personal", launch);
    assertEquals(result.verified, true);
    assertEquals(launched.length, 3);
    assertEquals(await listProfiles(root), [{ name: "Personal", directory, verified: true }]);
    assertEquals(JSON.parse(await Deno.readTextFile(`${root}/Local State`)), state);
    await Deno.remove(`${root}/${directory}/Preferences`);
    assertEquals((await inspectProfile(root, "Personal")).verified, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
Deno.test("conflicting profile folder and malformed Chrome state are errors, not empty inventories", async () => {
  const root = await Deno.makeTempDir();
  try {
    const directory = await profileDirectory("Work");
    await Deno.mkdir(`${root}/${directory}`);
    await Deno.writeTextFile(
      `${root}/${directory}/Preferences`,
      JSON.stringify({ profile: { name: "Other" } }),
    );
    await assertRejects(
      () => createProfile(root, "Work", () => Promise.resolve()),
      Error,
      "different settings",
    );
    await Deno.writeTextFile(`${root}/Local State`, "broken");
    await assertRejects(() => listProfiles(root));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
Deno.test("profile API validates names, methods and local-only access before creating", async () => {
  let calls = 0;
  const profiles = () => {
    calls++;
    return Promise.resolve({ profiles: [] });
  };
  for (
    const [suffix, method, body, status] of [
      ["create", "GET", undefined, 405],
      ["create", "POST", '{"name":"../escape"}', 400],
      ["create", "POST", "invalid", 400],
      ["create", "POST", '{"name":"Work"}', 200],
      ["verify?name=Personal", "GET", undefined, 200],
      ["list", "GET", undefined, 200],
    ] as const
  ) {
    const response = (await handleAppSettings(
      new Request(`http://localhost:8893/api/apps/app-settings1/chrome-profiles/${suffix}`, {
        method,
        body,
      }),
      undefined,
      undefined,
      profiles,
    ))!;
    assertEquals(response.status, status);
    await response.body?.cancel();
  }
  assertEquals(calls, 3);
  for (
    const request of [
      new Request("https://example.com/api/apps/app-settings1/chrome-profiles/create", {
        method: "POST",
      }),
      new Request("http://localhost:8893/api/apps/app-settings1/chrome-profiles/create", {
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
