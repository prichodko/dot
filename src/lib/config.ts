import { homedir } from "os";
import { join } from "path";

export const DOTFILES_REPO = "prichodko/dotfiles";
export const DOTFILES_DIR = join(homedir(), ".dotfiles");
export const BACKUP_DIR = join(homedir(), ".dotfiles-backup");
export const HOME = homedir();
