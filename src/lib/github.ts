import { DOTFILES_DIR, DOTFILES_REPO } from "./config";
import { existsSync } from "fs";

export interface GitResult {
  ok: boolean;
  error?: string;
}

async function run(args: string[]): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: DOTFILES_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
    return { ok: false, error: error || `git ${args[0]} failed` };
  }

  return { ok: true };
}

export async function isRepoCloned(): Promise<boolean> {
  return existsSync(DOTFILES_DIR) && existsSync(`${DOTFILES_DIR}/.git`);
}

export async function cloneRepo(): Promise<GitResult> {
  const proc = Bun.spawn(
    ["git", "clone", `https://github.com/${DOTFILES_REPO}.git`, DOTFILES_DIR],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
    return { ok: false, error: error || "Failed to clone" };
  }

  return { ok: true };
}

export async function pullRepo(): Promise<GitResult> {
  return run(["pull", "--rebase"]);
}

export async function pushRepo(message: string): Promise<GitResult> {
  let result = await run(["add", "-A"]);
  if (!result.ok) return result;

  result = await run(["commit", "-m", message]);
  // "nothing to commit" is not an error
  if (!result.ok && result.error?.includes("nothing to commit")) {
    return { ok: true };
  }
  if (!result.ok) return result;

  return run(["push"]);
}

export async function commitRepo(message: string): Promise<GitResult> {
  let result = await run(["add", "-A"]);
  if (!result.ok) return result;

  return run(["commit", "-m", message]);
}

export async function push(): Promise<GitResult> {
  return run(["push"]);
}

export async function getUncommittedChanges(): Promise<string[]> {
  const proc = Bun.spawn(["git", "status", "--porcelain"], {
    cwd: DOTFILES_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3)); // remove status prefix (e.g., " M ")
}
