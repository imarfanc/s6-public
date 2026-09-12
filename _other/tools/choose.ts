import { config } from "./_config.ts";
import { readTasks } from "./choose-lib.ts";
import { pick } from "./picker.ts";
import { bold, fail, muted } from "./style.ts";

/** The host repository's own tasks, so `_other/` works dropped into any repo. */
const TASKS = readTasks(config.root);
if (TASKS.length === 0) fail(`no tasks found in ${config.root}deno.json`);

/** Derived, so adding a task never leaves a stale hint or a dead number key. */
const NUMBERED = Math.min(TASKS.length, 9);
const NUMBERS = NUMBERED === 1 ? "1" : `1–${NUMBERED}`;

if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
  console.log(`${bold("choose")} — select a primary repository task

${muted("Usage")}
  deno task choose
  deno task choose <${TASKS.map(({ name }) => name).join("|")}>

${muted("Controls")}
  ${bold("↑/↓")} or ${bold("j/k")}   move
  ${bold(NUMBERS)}          run by number
  ${bold("enter")}        run selected
  ${bold("click")}        select; click the selected task to run
  ${bold("wheel")}        move
  ${bold("esc")}/${bold("q")}        cancel`);
  Deno.exit(0);
}

const requested = Deno.args[0];
if (requested) {
  const task = TASKS.find(({ name }) => name === requested);
  if (!task) fail(`unknown task: ${requested}`);
  Deno.exit(await run(task.name));
}

try {
  const selected = await pick(config.title, "Repository tasks · choose an action", TASKS);
  if (selected !== null) Deno.exit(await run(TASKS[selected]!.name));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function run(name: string): Promise<number> {
  console.log(`\n${muted(`$ deno task ${name}`)}\n`);
  const child = new Deno.Command(Deno.execPath(), {
    args: ["task", name],
    cwd: config.root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  return (await child.status).code;
}
