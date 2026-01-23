#!/usr/bin/env bun
import * as p from "@clack/prompts";
import c from "picocolors";
import { existsSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { DOTFILES_DIR, DOTFILES_REPO, HOME } from "./lib/config";
import {
  isRepoCloned,
  cloneRepo,
  pullRepo,
  pushRepo,
  commitRepo,
  push,
  getUncommittedChanges,
} from "./lib/github";
import {
  getAllTrackedFiles,
  isInRepo,
  linkFile,
  copyToRepo,
  removeFromRepo,
  openDiffTool,
  syncFile,
  filesMatch,
  type FileStatus,
} from "./lib/sync";

const statusIcon: Record<FileStatus, string> = {
  synced: c.green("✓"),
  unlinked: c.dim("○"),
  diverged: c.yellow("!"),
};

// =============================================================================
// COMMANDS
// =============================================================================

async function addFile(filePath: string) {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);

  if (!existsSync(absolutePath)) {
    p.log.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  if (!absolutePath.startsWith(HOME)) {
    p.log.error(`File must be inside HOME (${HOME})`);
    process.exit(1);
  }

  const relativePath = relative(HOME, absolutePath);

  await ensureRepo();

  if (isInRepo(relativePath)) {
    p.log.warn(`${relativePath} is already tracked`);
    p.outro(c.dim("Nothing to do"));
    return;
  }

  const s = p.spinner();
  s.start("Adding...");

  await copyToRepo(relativePath);
  await commitRepo(`add ${relativePath}`);

  s.stop(c.green(`Added ${relativePath}`));

  const shouldPush = await p.confirm({
    message: "Push to remote?",
    initialValue: true,
  });

  if (p.isCancel(shouldPush) || !shouldPush) {
    p.outro(c.dim("Committed locally"));
    return;
  }

  const pushSpin = p.spinner();
  pushSpin.start("Pushing...");
  const pushResult = await push();
  if (!pushResult.ok) {
    pushSpin.stop(c.red("Push failed"));
    if (pushResult.error) p.log.error(pushResult.error);
    process.exit(1);
  }
  pushSpin.stop(c.green("Pushed"));

  p.outro(c.green("Done!"));
}

async function removeFile(filePath: string) {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  const relativePath = absolutePath.startsWith(HOME)
    ? relative(HOME, absolutePath)
    : filePath;

  await ensureRepo();

  if (!isInRepo(relativePath)) {
    p.log.error(`${relativePath} is not tracked`);
    process.exit(1);
  }

  const confirm = await p.confirm({
    message: `Remove ${c.cyan(relativePath)} from dotfiles?`,
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro(c.dim("Cancelled"));
    return;
  }

  const s = p.spinner();
  s.start("Removing...");

  await removeFromRepo(relativePath);
  await commitRepo(`remove ${relativePath}`);

  s.stop(c.green(`Removed ${relativePath}`));

  const shouldPush = await p.confirm({
    message: "Push to remote?",
    initialValue: true,
  });

  if (p.isCancel(shouldPush) || !shouldPush) {
    p.outro(c.dim("Committed locally"));
    return;
  }

  const pushSpin = p.spinner();
  pushSpin.start("Pushing...");
  const pushResult = await push();
  if (!pushResult.ok) {
    pushSpin.stop(c.red("Push failed"));
    if (pushResult.error) p.log.error(pushResult.error);
    process.exit(1);
  }
  pushSpin.stop(c.green("Pushed"));

  p.outro(c.green("Done!"));
}

async function showStatus() {
  await ensureRepo();

  const files = getAllTrackedFiles();

  const synced = files.filter((f) => f.status === "synced");
  const unlinked = files.filter((f) => f.status === "unlinked");
  const diverged = files.filter((f) => f.status === "diverged");

  if (unlinked.length === 0 && diverged.length === 0) {
    console.log(c.green(`✓ All ${synced.length} files synced`));
    return;
  }

  if (synced.length) {
    console.log(c.green(`✓ ${synced.length} synced`));
  }
  if (diverged.length) {
    console.log(c.yellow(`! ${diverged.length} diverged`));
    diverged.forEach((f) => console.log(c.dim(`  ${f.path}`)));
  }
  if (unlinked.length) {
    console.log(c.dim(`○ ${unlinked.length} unlinked`));
    unlinked.forEach((f) => console.log(c.dim(`  ${f.path}`)));
  }
}

async function showList() {
  await ensureRepo();

  const files = getAllTrackedFiles();

  const groups = [...new Set(files.map((f) => f.group))].sort((a, b) => {
    if (a === "~") return -1;
    if (b === "~") return 1;
    return a.localeCompare(b);
  });

  for (const group of groups) {
    console.log(c.bold(group));
    files
      .filter((f) => f.group === group)
      .forEach((f) => console.log(c.dim(`  ${f.path}`)));
  }
}

// =============================================================================
// INTERACTIVE SYNC
// =============================================================================

async function runSync() {
  await ensureRepo();

  // pull latest
  const s = p.spinner();
  s.start("Syncing...");
  const pullResult = await pullRepo();
  if (!pullResult.ok) {
    s.stop(c.red("Sync failed"));
    if (pullResult.error) p.log.error(pullResult.error);
    process.exit(1);
  }
  s.stop(c.green("Synced"));

  // check for uncommitted changes (edits to symlinked files)
  const uncommitted = await getUncommittedChanges();
  if (uncommitted.length > 0) {
    p.log.info(`Local changes: ${uncommitted.join(", ")}`);
    
    const shouldSync = await p.confirm({
      message: "Sync?",
      initialValue: true,
    });

    if (!p.isCancel(shouldSync) && shouldSync) {
      const spin = p.spinner();
      spin.start("Syncing...");
      const result = await pushRepo(`sync ${uncommitted.join(", ")}`);
      if (!result.ok) {
        spin.stop(c.red("Sync failed"));
        if (result.error) p.log.error(result.error);
        process.exit(1);
      }
      spin.stop(c.green("Synced"));
    }
  }

  const files = getAllTrackedFiles();
  const needsAction = files.filter((f) => f.status !== "synced");

  if (needsAction.length === 0) {
    p.log.success("Everything up to date!");
    p.outro(c.dim(`${files.length} files`));
    return;
  }

  // build grouped options
  const options: Record<string, { value: string; label: string }[]> = {};

  const groups = [...new Set(needsAction.map((f) => f.group))].sort((a, b) => {
    if (a === "~") return -1;
    if (b === "~") return 1;
    return a.localeCompare(b);
  });

  for (const group of groups) {
    const groupFiles = needsAction.filter((f) => f.group === group);
    if (groupFiles.length === 0) continue;

    options[group] = groupFiles.map((f) => ({
      value: f.path,
      label: `${statusIcon[f.status]} ${f.path}`,
    }));
  }

  p.log.message(c.dim(`${statusIcon.unlinked} unlinked  ${statusIcon.diverged} diverged`));

  const selected = await p.groupMultiselect({
    message: "Select files",
    options,
    initialValues: needsAction.map((f) => f.path),
    required: false,
    groupSpacing: 1,
  });

  if (p.isCancel(selected) || !selected || selected.length === 0) {
    p.outro(c.dim("Nothing to do"));
    return;
  }

  const selectedPaths = selected as string[];
  const toSync: string[] = [];
  const toLink: string[] = [];

  for (const path of selectedPaths) {
    const file = files.find((f) => f.path === path);
    if (!file) continue;

    if (file.status === "diverged") {
      toSync.push(path);
    } else if (file.status === "unlinked") {
      toLink.push(path);
    }
  }

  // handle diverged files (diff tool if content differs, otherwise just link)
  for (const path of toSync) {
    if (filesMatch(path)) {
      // content identical, just create symlink
      await linkFile(path);
      p.log.success(path);
    } else {
      // content differs, open diff tool
      p.log.warn(`~/${path}`);
      p.log.info("Opening diff tool...");
      
      await openDiffTool(path);
      await syncFile(path);
      
      p.log.success(path);
    }
  }

  // handle unlinked files
  if (toLink.length > 0) {
    const spin = p.spinner();
    spin.start("Linking...");
    for (const path of toLink) {
      await linkFile(path);
    }
    spin.stop(`${c.green("✓")} Linked ${toLink.length} files`);
  }

  // sync to remote if we synced any diverged files
  if (toSync.length > 0) {
    const spin = p.spinner();
    spin.start("Syncing...");
    const result = await pushRepo(`sync ${toSync.join(", ")}`);
    if (!result.ok) {
      spin.stop(c.red("Sync failed"));
      if (result.error) p.log.error(result.error);
      process.exit(1);
    }
    spin.stop(c.green("Synced"));
  }

  p.outro(c.green("Done!"));
}

// =============================================================================
// HELPERS
// =============================================================================

async function ensureRepo() {
  if (!(await isRepoCloned())) {
    const s = p.spinner();
    s.start(`Cloning ${DOTFILES_REPO}...`);
    const result = await cloneRepo();
    if (!result.ok) {
      s.stop(c.red("Failed to clone repo"));
      if (result.error) p.log.error(result.error);
      process.exit(1);
    }
    s.stop(c.green("Cloned dotfiles"));
  }
}

function showHelp() {
  console.log(`${c.bold("dot")} - dotfiles sync tool

${c.bold("Usage:")}
  dot              Interactive sync
  dot <file>       Add file to dotfiles
  dot rm <file>    Remove file from dotfiles
  dot status       Show sync status
  dot list         List tracked files
  dot help         Show this help

${c.bold("Status:")}
  ${statusIcon.synced} synced     Symlinked to repo
  ${statusIcon.unlinked} unlinked   In repo, not linked
  ${statusIcon.diverged} diverged   Local differs from repo`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // non-interactive commands (no intro/outro)
  if (cmd === "status") {
    await showStatus();
    return;
  }

  if (cmd === "list") {
    await showList();
    return;
  }

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    showHelp();
    return;
  }

  // interactive commands
  console.clear();
  p.intro(c.bgCyan(c.black(" dot ")));

  if (cmd === "rm" && args[1]) {
    await removeFile(args[1]);
    return;
  }

  if (cmd && !cmd.startsWith("-")) {
    await addFile(cmd);
    return;
  }

  await runSync();
}

main().catch((e) => {
  p.log.error(e.message);
  process.exit(1);
});
