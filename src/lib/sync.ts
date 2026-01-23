import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, statSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { BACKUP_DIR, DOTFILES_DIR, HOME } from "./config";

export type FileStatus = "synced" | "unlinked" | "diverged";

export interface FileInfo {
  path: string;
  group: string;
  status: FileStatus;
}

const IGNORED = new Set([".git", "README.md", ".DS_Store", "setup.sh"]);

function getGroup(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts[0] : "~";
}

export function getFileStatus(relativePath: string): FileStatus {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const homePath = join(HOME, relativePath);

  if (!existsSync(homePath)) return "unlinked";

  // check if it's a symlink pointing to repo
  try {
    const stat = lstatSync(homePath);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(homePath);
      if (target === repoPath) return "synced";
    }
  } catch {}

  // file exists but not symlinked to repo
  return "diverged";
}

export function filesMatch(relativePath: string): boolean {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const homePath = join(HOME, relativePath);

  try {
    const { readFileSync } = require("fs");
    const repoContent = readFileSync(repoPath, "utf-8");
    const homeContent = readFileSync(homePath, "utf-8");
    return repoContent === homeContent;
  } catch {
    return false;
  }
}

export function getAllTrackedFiles(): FileInfo[] {
  const files: FileInfo[] = [];

  function scanDir(dirPath: string, relativePath: string) {
    try {
      const entries = readdirSync(dirPath);
      for (const entry of entries) {
        if (IGNORED.has(entry)) continue;
        const fullPath = join(dirPath, entry);
        const relPath = relativePath ? join(relativePath, entry) : entry;
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          scanDir(fullPath, relPath);
        } else {
          files.push({
            path: relPath,
            group: getGroup(relPath),
            status: getFileStatus(relPath),
          });
        }
      }
    } catch {}
  }

  scanDir(DOTFILES_DIR, "");
  return files;
}

export function isInRepo(relativePath: string): boolean {
  return existsSync(join(DOTFILES_DIR, relativePath));
}

export async function linkFile(relativePath: string): Promise<void> {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const homePath = join(HOME, relativePath);

  // backup existing file if it's not already a symlink to repo
  if (existsSync(homePath)) {
    try {
      const stat = lstatSync(homePath);
      if (!stat.isSymbolicLink() || readlinkSync(homePath) !== repoPath) {
        const backupPath = join(BACKUP_DIR, relativePath);
        mkdirSync(dirname(backupPath), { recursive: true });
        await Bun.write(backupPath, Bun.file(homePath));
        console.log(`  Backed up to ${backupPath}`);
      }
    } catch {}
  }

  mkdirSync(dirname(homePath), { recursive: true });

  try {
    unlinkSync(homePath);
  } catch {}

  const { symlinkSync } = await import("fs");
  symlinkSync(repoPath, homePath);
}

export async function copyToRepo(relativePath: string): Promise<void> {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const homePath = join(HOME, relativePath);

  mkdirSync(dirname(repoPath), { recursive: true });
  await Bun.write(repoPath, Bun.file(homePath));
}

export async function removeFromRepo(relativePath: string): Promise<void> {
  const repoPath = join(DOTFILES_DIR, relativePath);

  try {
    unlinkSync(repoPath);
  } catch {}
}

export async function openDiffTool(relativePath: string): Promise<boolean> {
  const localPath = join(HOME, relativePath);
  const repoPath = join(DOTFILES_DIR, relativePath);

  // code --diff: left is editable (local), right is reference (dotfiles)
  // --wait: wait for user to close the diff tab
  const proc = Bun.spawn(["code", "--diff", localPath, repoPath, "--wait"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  await proc.exited;
  return proc.exitCode === 0;
}

export async function syncFile(relativePath: string): Promise<void> {
  const localPath = join(HOME, relativePath);
  const repoPath = join(DOTFILES_DIR, relativePath);

  // copy local → dotfiles
  mkdirSync(dirname(repoPath), { recursive: true });
  await Bun.write(repoPath, Bun.file(localPath));

  // replace local with symlink
  unlinkSync(localPath);
  const { symlinkSync } = await import("fs");
  symlinkSync(repoPath, localPath);
}
