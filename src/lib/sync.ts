import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { BACKUP_DIR, DOTFILES_DIR, HOME } from "./config";
import { categories } from "./categories";

export type FileStatus = "synced" | "local" | "remote" | "conflict" | "unlinked";

export interface FileInfo {
  path: string;
  category: string;
  status: FileStatus;
}

async function fileHash(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const content = await file.arrayBuffer();
    const hash = Bun.hash(content);
    return hash.toString();
  } catch {
    return null;
  }
}

/**
 * Get file status by comparing a file at basePath with the repo version.
 * @param relativePath - path relative to both basePath and repo (e.g., ".gitconfig")
 * @param basePath - the directory to compare against repo (e.g., HOME or cwd)
 */
export async function getFileStatus(
  relativePath: string,
  basePath: string = HOME
): Promise<FileStatus> {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const targetPath = join(basePath, relativePath);

  const repoExists = existsSync(repoPath);
  const targetExists = existsSync(targetPath);

  if (!repoExists) return "unlinked";
  if (!targetExists) return "unlinked";

  // for HOME, check if symlink points to repo (means synced)
  if (basePath === HOME) {
    try {
      const realPath = Bun.resolveSync(targetPath, basePath);
      if (realPath === repoPath) return "synced";
    } catch {}
  }

  // compare content
  const repoHash = await fileHash(repoPath);
  const targetHash = await fileHash(targetPath);

  if (repoHash === targetHash) return "synced";
  return "conflict";
}

/**
 * Get all tracked files from repo with their status.
 * @param basePath - the directory to compare against repo (e.g., HOME or cwd)
 */
export async function getAllTrackedFiles(basePath: string = HOME): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  for (const cat of categories) {
    for (const file of cat.files) {
      const repoPath = join(DOTFILES_DIR, file);
      if (!existsSync(repoPath)) continue;

      const stat = statSync(repoPath);
      if (stat.isDirectory()) {
        // expand directory
        const expanded = expandDir(repoPath, file);
        for (const f of expanded) {
          files.push({
            path: f,
            category: cat.name,
            status: await getFileStatus(f, basePath),
          });
        }
      } else {
        files.push({
          path: file,
          category: cat.name,
          status: await getFileStatus(file, basePath),
        });
      }
    }
  }

  return files;
}

function expandDir(dirPath: string, relativePath: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      if (entry.startsWith(".git")) continue;
      const fullPath = join(dirPath, entry);
      const relPath = join(relativePath, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...expandDir(fullPath, relPath));
      } else {
        results.push(relPath);
      }
    }
  } catch {}
  return results;
}

export async function linkFile(relativePath: string): Promise<void> {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const homePath = join(HOME, relativePath);

  // backup existing
  if (existsSync(homePath)) {
    const backupPath = join(BACKUP_DIR, relativePath);
    mkdirSync(dirname(backupPath), { recursive: true });
    await Bun.write(backupPath, Bun.file(homePath));
  }

  // create parent dirs
  mkdirSync(dirname(homePath), { recursive: true });

  // remove existing and symlink
  try {
    const { unlinkSync } = await import("fs");
    unlinkSync(homePath);
  } catch {}

  const { symlinkSync } = await import("fs");
  symlinkSync(repoPath, homePath);
}

/**
 * Copy a file from sourcePath to repo.
 * @param relativePath - path relative to sourcePath and repo
 * @param sourcePath - where to copy from (defaults to HOME)
 */
export async function copyToRepo(
  relativePath: string,
  sourcePath: string = HOME
): Promise<void> {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const fromPath = join(sourcePath, relativePath);

  mkdirSync(dirname(repoPath), { recursive: true });
  await Bun.write(repoPath, Bun.file(fromPath));
}

/**
 * Copy a file from repo to targetPath.
 * @param relativePath - path relative to repo and targetPath
 * @param targetPath - where to copy to (defaults to HOME)
 */
export async function copyFromRepo(
  relativePath: string,
  targetPath: string = HOME
): Promise<void> {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const toPath = join(targetPath, relativePath);

  // backup existing (only for HOME)
  if (existsSync(toPath) && targetPath === HOME) {
    const backupPath = join(BACKUP_DIR, relativePath);
    mkdirSync(dirname(backupPath), { recursive: true });
    await Bun.write(backupPath, Bun.file(toPath));
  }

  mkdirSync(dirname(toPath), { recursive: true });
  await Bun.write(toPath, Bun.file(repoPath));
}
