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

  // check if in a project (not home)
  const cwd = process.cwd();
  const inProject = cwd !== HOME && !cwd.startsWith(DOTFILES_DIR);

  // check if all synced
  const hasChanges = files.some((f) => f.status !== "synced");
  if (!hasChanges) {
    p.log.success("Everything up to date!");
    p.outro(c.dim(`~/.dotfiles (${DOTFILES_REPO})`));
    return;
  }

  // build options with status icons, pre-select changed files
  const options: Record<string, { value: string; label: string; hint?: string }[]> = {};
  const initialValues: string[] = [];

  for (const cat of categories) {
    const catFiles = files.filter((f) => f.category === cat.name);
    if (catFiles.length === 0) continue;

    options[cat.name] = catFiles.map((f) => {
      const icon = statusIcon[f.status];
      const hint = getHint(f.status, inProject);
      
      // pre-select changed files
      if (f.status !== "synced") {
        initialValues.push(f.path);
      }

      return {
        value: f.path,
        label: `${icon} ${f.path}`,
        hint,
      };
    });
  }

  p.log.message(c.dim(`~/.dotfiles (${DOTFILES_REPO})`));

  // combined status + selection
  const selected = await p.groupMultiselect({
    message: "Select files to sync",
    options,
    initialValues,
    required: false,
  });

  if (p.isCancel(selected) || !selected || selected.length === 0) {
    p.outro(c.dim("Nothing to do"));
    return;
  }

  // categorize selected files by action
  const toPush: string[] = [];
  const toPull: string[] = [];
  const toLink: string[] = [];
  const conflicts: string[] = [];
  const toCopy: string[] = [];

  for (const path of selected as string[]) {
    const file = files.find((f) => f.path === path);
    if (!file) continue;

    if (file.status === "local") {
      if (inProject) {
        toCopy.push(path);
      } else {
        toPush.push(path);
      }
    } else if (file.status === "remote") {
      toPull.push(path);
    } else if (file.status === "unlinked") {
      if (inProject) {
        toCopy.push(path);
      } else {
        toLink.push(path);
      }
    } else if (file.status === "conflict") {
      conflicts.push(path);
    }
  }

  // handle conflicts - ask for each
  for (const path of conflicts) {
    const action = await p.select({
      message: `${c.red("!")} ${path} has conflicts. What to do?`,
      options: [
        { value: "pull", label: "Pull", hint: "overwrite local with remote" },
        { value: "push", label: "Push", hint: "overwrite remote with local" },
        { value: "skip", label: "Skip" },
      ],
    });

    if (p.isCancel(action)) continue;
    if (action === "pull") toPull.push(path);
    if (action === "push") toPush.push(path);
  }

  // show summary and confirm
  const summary: string[] = [];
  if (toPull.length) summary.push(`${c.blue("↓")} Pull: ${toPull.length}`);
  if (toPush.length) summary.push(`${c.yellow("↑")} Push: ${toPush.length}`);
  if (toLink.length) summary.push(`${c.dim("○")} Link: ${toLink.length}`);
  if (toCopy.length) summary.push(`${c.cyan("→")} Copy: ${toCopy.length}`);

  if (summary.length === 0) {
    p.outro(c.dim("Nothing to do"));
    return;
  }

  p.log.message("");
  p.log.message(summary.join("  "));

  const confirm = await p.confirm({
    message: "Proceed?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro(c.dim("Cancelled"));
    return;
  }

  // execute actions
  const spin = p.spinner();

  // 1. Pull first
  if (toPull.length) {
    spin.start("Pulling...");
    await pullRepo();
    for (const path of toPull) {
      await linkFile(path);
    }
    spin.stop(`${c.blue("↓")} Pulled ${toPull.length} files`);
  }

  // 2. Push
  if (toPush.length) {
    spin.start("Pushing...");
    for (const path of toPush) {
      await copyToRepo(path);
    }
    await pushRepo(`update ${toPush.length} files`);
    spin.stop(`${c.yellow("↑")} Pushed ${toPush.length} files`);
  }

  // 3. Link
  if (toLink.length) {
    spin.start("Linking...");
    for (const path of toLink) {
      await linkFile(path);
    }
    spin.stop(`${c.dim("○")} Linked ${toLink.length} files`);
  }

  // 4. Copy to project
  if (toCopy.length) {
    spin.start("Copying to project...");
    for (const path of toCopy) {
      await copyFromRepo(path, cwd);
    }
    spin.stop(`${c.cyan("→")} Copied ${toCopy.length} files`);
  }

  p.outro(c.green("Done!"));
}

function getHint(status: FileStatus, inProject: boolean): string | undefined {
  switch (status) {
    case "local":
      return inProject ? "copy to project" : "will push";
    case "remote":
      return "will pull";
    case "unlinked":
      return inProject ? "copy to project" : "will link";
    case "conflict":
      return "needs resolve";
    default:
      return undefined;
  }
}

main().catch((e) => {
  p.log.error(e.message);
  process.exit(1);
});
