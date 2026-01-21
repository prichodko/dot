import { homedir } from "os";
import { join } from "path";

export const DOTFILES_REPO = "prichodko/dotfiles";
export const DOTFILES_DIR = join(homedir(), ".dotfiles");
export const BACKUP_DIR = join(homedir(), ".dotfiles-backup");
export const HOME = homedir();

export interface Config {
  repo: string;
  lastSync?: string;
}

export async function loadConfig(): Promise<Config> {
  const configPath = join(DOTFILES_DIR, ".dotrc");
  try {
    const file = Bun.file(configPath);
    if (await file.exists()) {
      return await file.json();
    }
  } catch {}
  return { repo: DOTFILES_REPO };
}

export async function saveConfig(config: Config): Promise<void> {
  const configPath = join(DOTFILES_DIR, ".dotrc");
  await Bun.write(configPath, JSON.stringify(config, null, 2));
}
