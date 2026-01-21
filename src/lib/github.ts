import { DOTFILES_DIR, DOTFILES_REPO } from "./config";
import { existsSync } from "fs";

export async function isRepoCloned(): Promise<boolean> {
  return existsSync(DOTFILES_DIR) && existsSync(`${DOTFILES_DIR}/.git`);
}

export async function cloneRepo(): Promise<boolean> {
  const proc = Bun.spawn(
    ["git", "clone", `https://github.com/${DOTFILES_REPO}.git`, DOTFILES_DIR],
    { stdout: "pipe", stderr: "pipe" }
  );
  await proc.exited;
  return proc.exitCode === 0;
}

export async function pullRepo(): Promise<boolean> {
  const proc = Bun.spawn(["git", "pull", "--rebase"], {
    cwd: DOTFILES_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  return proc.exitCode === 0;
}

export async function pushRepo(message: string): Promise<boolean> {
  const add = Bun.spawn(["git", "add", "-A"], {
    cwd: DOTFILES_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  await add.exited;

  const commit = Bun.spawn(["git", "commit", "-m", message], {
    cwd: DOTFILES_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  await commit.exited;

  const push = Bun.spawn(["git", "push"], {
    cwd: DOTFILES_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  await push.exited;
  return push.exitCode === 0;
}

export async function getRemoteChanges(): Promise<string[]> {
  // fetch first
  const fetch = Bun.spawn(["git", "fetch"], {
    cwd: DOTFILES_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  await fetch.exited;

  // diff with remote
  const proc = Bun.spawn(
    ["git", "diff", "--name-only", "HEAD", "origin/main"],
    {
      cwd: DOTFILES_DIR,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output
    .trim()
    .split("\n")
    .filter((f) => f);
}

export async function getLocalChanges(): Promise<string[]> {
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
    .filter((f) => f)
    .map((line) => line.slice(3)); // remove status prefix
}
