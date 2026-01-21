#!/usr/bin/env bun
import * as p from "@clack/prompts";
import c from "picocolors";
import { DOTFILES_DIR, DOTFILES_REPO, HOME } from "./lib/config";
import { categories } from "./lib/categories";
import {
  isRepoCloned,
  cloneRepo,
  pullRepo,
  pushRepo,
  getRemoteChanges,
  getLocalChanges,
} from "./lib/github";
import {
  getAllTrackedFiles,
  linkFile,
  copyToRepo,
  copyFromRepo,
  type FileInfo,
  type FileStatus,
} from "./lib/sync";

const statusIcon: Record<FileStatus, string> = {
  synced: c.green("✓"),
  local: c.yellow("↑"),
  remote: c.blue("↓"),
  conflict: c.red("!"),
  unlinked: c.dim("○"),
};

async function main() {
  console.clear();
  p.intro(c.bgCyan(c.black(" dot ")));

  // check if repo exists, clone if not
  if (!(await isRepoCloned())) {
    const s = p.spinner();
    s.start(`Cloning ${DOTFILES_REPO}...`);
    const ok = await cloneRepo();
    if (!ok) {
      s.stop(c.red("Failed to clone repo"));
      process.exit(1);
    }
    s.stop(c.green("Cloned dotfiles"));
  }

  // get status
  const s = p.spinner();
  s.start("Checking status...");
  const files = await getAllTrackedFiles();
  const remoteChanges = await getRemoteChanges();
  const localChanges = await getLocalChanges();
  s.stop("Status loaded");

  // update file statuses based on git
  for (const f of files) {
    if (remoteChanges.includes(f.path) && localChanges.includes(f.path)) {
      f.status = "conflict";
    } else if (remoteChanges.includes(f.path)) {
      f.status = "remote";
    } else if (localChanges.includes(f.path)) {
      f.status = "local";
    }
  }

  // show status grouped by category
  p.log.message(c.dim(`~/.config/dotfiles (${DOTFILES_REPO})`));
  p.log.message("");

  const byCategory = new Map<string, FileInfo[]>();
  for (const f of files) {
    const list = byCategory.get(f.category) || [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  for (const [cat, catFiles] of byCategory) {
    p.log.message(c.bold(cat));
    for (const f of catFiles) {
      p.log.message(`  ${statusIcon[f.status]} ${f.path}`);
    }
  }

  p.log.message("");
  p.log.message(
    c.dim(`${statusIcon.synced} synced  ${statusIcon.local} local  ${statusIcon.remote} remote  ${statusIcon.conflict} conflict  ${statusIcon.unlinked} unlinked`)
  );

  // check if in a project (not home)
  const cwd = process.cwd();
  const inProject = cwd !== HOME && !cwd.startsWith(DOTFILES_DIR);

  // action menu
  const action = await p.select({
    message: "What to do?",
    options: [
      { value: "pull", label: "Pull", hint: "download from repo" },
      { value: "push", label: "Push", hint: "upload local changes" },
      { value: "link", label: "Link", hint: "symlink unlinked files" },
      ...(inProject
        ? [{ value: "copy", label: "Copy to project", hint: cwd }]
        : []),
      { value: "exit", label: "Exit" },
    ],
  });

  if (p.isCancel(action) || action === "exit") {
    p.outro(c.dim("Bye!"));
    return;
  }

  if (action === "pull") {
    await handlePull(files, inProject ? cwd : undefined);
  } else if (action === "push") {
    await handlePush(files, localChanges);
  } else if (action === "link") {
    await handleLink(files);
  } else if (action === "copy") {
    await handleCopyToProject(files, cwd);
  }

  p.outro(c.green("Done!"));
}

async function handlePull(files: FileInfo[], targetDir?: string) {
  // build options grouped by category
  const options: Record<string, { value: string; label: string; hint?: string }[]> = {};
  for (const cat of categories) {
    const catFiles = files.filter((f) => f.category === cat.name);
    if (catFiles.length === 0) continue;
    options[cat.name] = catFiles.map((f) => ({
      value: f.path,
      label: f.path,
      hint: f.status !== "synced" ? f.status : undefined,
    }));
  }

  const selected = await p.groupMultiselect({
    message: "Select files to pull",
    options,
    required: false,
  });

  if (p.isCancel(selected) || !selected || selected.length === 0) {
    p.log.warn("Nothing selected");
    return;
  }

  // pull repo first
  const s = p.spinner();
  s.start("Pulling from remote...");
  await pullRepo();
  s.stop("Pulled latest");

  // copy/link files
  s.start("Syncing files...");
  for (const path of selected as string[]) {
    if (targetDir) {
      await copyFromRepo(path, targetDir);
    } else {
      await linkFile(path);
    }
  }
  s.stop(`Synced ${(selected as string[]).length} files`);
}

async function handlePush(files: FileInfo[], localChanges: string[]) {
  const changedFiles = files.filter(
    (f) => f.status === "local" || localChanges.includes(f.path)
  );

  if (changedFiles.length === 0) {
    p.log.warn("No local changes to push");
    return;
  }

  const options: Record<string, { value: string; label: string }[]> = {};
  for (const cat of categories) {
    const catFiles = changedFiles.filter((f) => f.category === cat.name);
    if (catFiles.length === 0) continue;
    options[cat.name] = catFiles.map((f) => ({
      value: f.path,
      label: f.path,
    }));
  }

  const selected = await p.groupMultiselect({
    message: "Select files to push",
    options,
    required: false,
  });

  if (p.isCancel(selected) || !selected || selected.length === 0) {
    p.log.warn("Nothing selected");
    return;
  }

  // copy files to repo
  const s = p.spinner();
  s.start("Copying to repo...");
  for (const path of selected as string[]) {
    await copyToRepo(path);
  }
  s.stop("Copied files");

  // commit message
  const message = await p.text({
    message: "Commit message",
    placeholder: "update dotfiles",
  });

  if (p.isCancel(message)) return;

  s.start("Pushing to GitHub...");
  const ok = await pushRepo(message || "update dotfiles");
  if (ok) {
    s.stop(c.green("Pushed to GitHub"));
  } else {
    s.stop(c.red("Failed to push"));
  }
}

async function handleLink(files: FileInfo[]) {
  const unlinked = files.filter((f) => f.status === "unlinked");

  if (unlinked.length === 0) {
    p.log.warn("All files already linked");
    return;
  }

  const options: Record<string, { value: string; label: string }[]> = {};
  for (const cat of categories) {
    const catFiles = unlinked.filter((f) => f.category === cat.name);
    if (catFiles.length === 0) continue;
    options[cat.name] = catFiles.map((f) => ({
      value: f.path,
      label: f.path,
    }));
  }

  const selected = await p.groupMultiselect({
    message: "Select files to link",
    options,
    required: false,
  });

  if (p.isCancel(selected) || !selected || selected.length === 0) {
    p.log.warn("Nothing selected");
    return;
  }

  const s = p.spinner();
  s.start("Linking files...");
  for (const path of selected as string[]) {
    await linkFile(path);
  }
  s.stop(`Linked ${(selected as string[]).length} files`);
}

async function handleCopyToProject(files: FileInfo[], targetDir: string) {
  // only show claude files for project copy
  const claudeFiles = files.filter((f) => f.category === "Claude");

  if (claudeFiles.length === 0) {
    p.log.warn("No Claude files to copy");
    return;
  }

  const selected = await p.multiselect({
    message: "Select files to copy to project",
    options: claudeFiles.map((f) => ({
      value: f.path,
      label: f.path,
    })),
    required: false,
  });

  if (p.isCancel(selected) || !selected || selected.length === 0) {
    p.log.warn("Nothing selected");
    return;
  }

  const s = p.spinner();
  s.start("Copying to project...");
  for (const path of selected as string[]) {
    await copyFromRepo(path, targetDir);
  }
  s.stop(`Copied ${(selected as string[]).length} files to ${targetDir}`);
}

main().catch((e) => {
  p.log.error(e.message);
  process.exit(1);
});
