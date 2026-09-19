import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { aiArgs, aiPrompt, parseAiReport, shellQuote, signInOptions } from "./ai-profiles.ts";
import { handleAppSettings } from "./route.ts";
import { handleRequest } from "../../../backends/routes/router.ts";

Deno.test("Terminal shell quoting preserves names and paths without executing substitutions", async () => {
  const value = `A 'quoted' $(printf INJECTED) \`printf BAD\` $HOME name`;
  const result = await new Deno.Command("/bin/sh", {
    args: ["-c", `printf %s ${shellQuote(value)}`],
    stdout: "piped",
  }).output();
  assertEquals(new TextDecoder().decode(result.stdout), value);
});
Deno.test("AI command uses Luna max and this computer's helper without editing global config", () => {
  const args = aiArgs({
    computerUse: "/Users/example/.codex/computer-use",
    helper: "/Users/example/helper app",
  }, "/tmp/work space");
  assertEquals(args.slice(0, 5), [
    "exec",
    "-m",
    "gpt-5.6-luna",
    "-c",
    'model_reasoning_effort="max"',
  ]);
  assertEquals(
    args.includes('mcp_servers.computer-use.cwd="/Users/example/.codex/computer-use"'),
    true,
  );
  assertEquals(args.includes("danger-full-access"), true);
  assertStringIncludes(aiPrompt("Work"), 'JSON string "Work"');
  assertStringIncludes(aiPrompt("Work"), "do not create a duplicate");
  assertStringIncludes(aiPrompt("Work"), "stay signed out");
  const signedIn = aiPrompt("Work", { signIn: true, account: "me@example.com" });
  assertStringIncludes(signedIn, '"me@example.com"');
  assertStringIncludes(signedIn, "never type passwords");
});
Deno.test("sign-in options ignore the account when staying signed out and reject bad input", () => {
  assertEquals(signInOptions({ account: "me@example.com" }), { signIn: false, account: null });
  assertEquals(signInOptions({ signIn: true, account: " " }), { signIn: true, account: null });
  assertEquals(signInOptions({ signIn: true, account: "+1 555 0100" }).account, "+1 555 0100");
  assertThrows(() => signInOptions({ signIn: true, account: "a\nb" }));
});
Deno.test("AI launch only accepts POST with a validated name and inherits origin gates", async () => {
  const names: unknown[] = [];
  const launch = (name: unknown) => {
    names.push(name);
    return Promise.resolve({ name: String(name), launched: true, message: "Started" });
  };
  for (
    const [method, body, expected] of [
      ["GET", undefined, 405],
      ["POST", '{"name":"../bad"}', 400],
      ["POST", '{"name":"Work"}', 200],
    ] as const
  ) {
    const response = (await handleAppSettings(
      new Request("http://localhost:8893/api/apps/app-settings1/chrome-profiles/ai-create", {
        method,
        body,
      }),
      undefined,
      undefined,
      undefined,
      launch,
    ))!;
    assertEquals(response.status, expected);
    await response.body?.cancel();
  }
  assertEquals(names, ["Work"]);
  const response = await handleRequest(
    new Request("https://example.com/api/apps/app-settings1/chrome-profiles/ai-create", {
      method: "POST",
    }),
  );
  assertEquals(response.status, 403);
  await response.body?.cancel();
});

Deno.test("AI stops at first error and error summaries cannot become sign-in handoffs", () => {
  const prompt = aiPrompt("p3a", { signIn: true, account: "test_name" });
  assertStringIncludes(prompt, "At the first tool failure");
  assertStringIncludes(prompt, "Do not retry");
  assertStringIncludes(prompt, "do not invent a timestamp");
  assertStringIncludes(prompt, "Do not navigate back to the picker");
  const report = {
    status: "needs_user",
    summary: "Account rejected",
    last_step: "Clicked Next",
    error: "Couldn’t find this account",
    next_action: "Use a valid account",
  };
  assertEquals(parseAiReport(JSON.stringify(report)).status, "error");
  assertEquals(
    parseAiReport(JSON.stringify({ ...report, error: "", summary: "Password screen reached" }))
      .status,
    "needs_user",
  );
  assertEquals(
    parseAiReport(JSON.stringify({ ...report, status: "completed", error: "" })).status,
    "completed",
  );
  assertThrows(() => parseAiReport('{"status":"completed"}'));
  assertThrows(() => parseAiReport("invalid"));
  assertThrows(() => signInOptions({ signIn: true, account: "your.name@example.com" }));
});

Deno.test("stale username exception permits one replacement only for a supplied sign-in account", () => {
  const prompt = aiPrompt("p3b", { signIn: true, account: "your.name" });
  assertStringIncludes(prompt, "different, non-empty username");
  assertStringIncludes(prompt, 'supplied account "your.name"');
  assertStringIncludes(prompt, "click Next once");
  assertStringIncludes(prompt, "field already matches the supplied account");
  assertStringIncludes(
    prompt,
    "any error (including the same account-not-found message persisting) must stop",
  );
  assertStringIncludes(prompt, "never permits recovery from tool failures");
  assertStringIncludes(
    aiPrompt("p3b", { signIn: true, account: null }),
    "No stale-username exception applies",
  );
  assertStringIncludes(aiPrompt("p3b"), "No stale-username exception applies");
});
