import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join, relative } from "path";
import { BACKUP_DIR, DOTFILES_DIR, HOME } from "./config";
import { categories, getCategoryForFile } from "./categories";

export type FileStatus = "synced" | "local" | "remote" | "conflict" | "unlinked";

export interface FileInfo {
  path: string;
  category: string;
  status: FileStatus;
  isDir: boolean;
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

export async function getFileStatus(relativePath: string): Promise<FileStatus> {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const homePath = join(HOME, relativePath);

  const repoExists = existsSync(repoPath);
  const homeExists = existsSync(homePath);

  if (!repoExists) return "unlinked";
  if (!homeExists) return "unlinked";

  // check if symlink points to repo
  try {
    const linkTarget = await Bun.file(homePath).text().catch(() => null);
    const realPath = Bun.resolveSync(homePath, HOME);
    if (realPath === repoPath) return "synced";
  } catch {}

  // compare content
  const repoHash = await fileHash(repoPath);
  const homeHash = await fileHash(homePath);

  if (repoHash === homeHash) return "synced";
  return "conflict";
}

export async function getAllTrackedFiles(): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  for (const cat of categories) {
    for (const file of cat.files) {
      const repoPath = join(DOTFILES_DIR, file);
      if (!existsSync(repoPath)) continue;

      const stat = statSync(repoPath);
      if (stat.isDirectory()) {
        // expand directory
        const expanded = await expandDir(repoPath, file);
        for (const f of expanded) {
          files.push({
            path: f.path,
            category: cat.name,
            status: await getFileStatus(f.path),
            isDir: f.isDir,
          });
        }
      } else {
        files.push({
          path: file,
          category: cat.name,
          status: await getFileStatus(file),
          isDir: false,
        });
      }
    }
  }

  return files;
}

async function expandDir(
  dirPath: string,
  relativePath: string
): Promise<{ path: string; isDir: boolean }[]> {
  const results: { path: string; isDir: boolean }[] = [];
  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      if (entry.startsWith(".git")) continue;
      const fullPath = join(dirPath, entry);
      const relPath = join(relativePath, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...(await expandDir(fullPath, relPath)));
      } else {
        results.push({ path: relPath, isDir: false });
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

export async function copyToRepo(relativePath: string): Promise<void> {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const homePath = join(HOME, relativePath);

  mkdirSync(dirname(repoPath), { recursive: true });
  await Bun.write(repoPath, Bun.file(homePath));
}

export async function copyFromRepo(
  relativePath: string,
  targetDir: string = HOME
): Promise<void> {
  const repoPath = join(DOTFILES_DIR, relativePath);
  const targetPath = join(targetDir, relativePath);

  // backup existing
  if (existsSync(targetPath) && targetDir === HOME) {
    const backupPath = join(BACKUP_DIR, relativePath);
    mkdirSync(dirname(backupPath), { recursive: true });
    await Bun.write(backupPath, Bun.file(targetPath));
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  await Bun.write(targetPath, Bun.file(repoPath));
}
