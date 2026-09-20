import { aiSetup, launchTerminal, printSummary, runAiProfile, shellQuote } from "./ai-profiles.ts";
import { runSearch, searchProfiles } from "./search.ts";

export async function launchAiSearch(all = false) {
  await aiSetup();
  const targets = all ? await searchProfiles() : [];
  const target = all ? null : await runSearch("verify");
  const source = decodeURIComponent(new URL(import.meta.url).pathname);
  const cmd = [
    Deno.execPath(),
    "run",
    "-A",
    source,
    ...(all ? ["--all"] : [target!.profile, target!.directory]),
  ].map(
    shellQuote,
  ).join(" ");
  await launchTerminal(cmd);
  return {
    launched: true,
    message: `Started Luna max in Terminal for ${
      all ? `all ${targets.length} profiles, one at a time` : target!.profile
    }: change to DuckDuckGo using computer use, then verify the same profile. Watch Terminal for the timestamped summary.`,
  };
}
export async function runAllSearch(
  profiles: { name: string; directory: string }[],
  run: (name: string, directory: string) => Promise<string | undefined> = (name, directory) =>
    runAiProfile(name, { signIn: false, account: null }, directory),
) {
  const completed: string[] = [];
  for (const [index, profile] of profiles.entries()) {
    console.log(
      `\nProfile ${index + 1}/${profiles.length}: ${profile.name} (${profile.directory})`,
    );
    try {
      const status = await run(profile.name, profile.directory);
      if (status !== "completed") {
        printSummary(
          "All Chrome profiles",
          status ?? "error",
          `${completed.length}/${profiles.length} verified. Stopped at ${profile.name}; remaining profiles were not attempted.`,
          "Resolve the reported issue, then run again; verified profiles will be skipped.",
        );
        return { completed, stopped: profile.directory };
      }
      completed.push(profile.directory);
    } catch (error) {
      throw new Error(
        `${completed.length}/${profiles.length} profiles verified. Stopped at ${profile.name}; remaining profiles were not attempted. ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
  printSummary(
    "All Chrome profiles",
    "completed",
    `DuckDuckGo verified in all ${completed.length} profiles.`,
    "None.",
  );
  return { completed, stopped: null };
}
if (import.meta.main) {
  try {
    if (Deno.args[0] === "--all") {
      await runAllSearch(await searchProfiles());
    } else {
      if (!Deno.args[0] || !Deno.args[1]) {
        throw new Error("A Chrome profile name and directory are required.");
      }
      await runAiProfile(Deno.args[0], { signIn: false, account: null }, Deno.args[1]);
    }
  } catch (error) {
    printSummary(
      "Chrome search engine",
      "error",
      "Run stopped.",
      "Resolve the error before retrying.",
      "See Terminal output above.",
      error instanceof Error ? error.message : String(error),
    );
    Deno.exitCode = 1;
  }
}
