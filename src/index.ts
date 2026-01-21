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
  conflict: c.red("⚡"),
  unlinked: c.dim("○"),
};

type Mode = "global" | "local";

async function main() {
  console.clear();
  p.intro(c.bgCyan(c.black(" dot ")));

  // detect context: are we in a project directory?
  const cwd = process.cwd();
  const isInProject = cwd !== HOME && !cwd.startsWith(DOTFILES_DIR);
  const projectName = isInProject ? cwd.split("/").pop() : undefined;

  // prompt for mode with auto-detected default
  const mode = await p.select({
    message: "Sync mode",
    options: [
      {
        value: "global" as const,
        label: "Global",
        hint: "symlink to ~",
      },
      {
        value: "local" as const,
        label: "Local",
        hint: isInProject ? `copy to ${projectName}` : "copy to cwd",
      },
    ],
    initialValue: (isInProject ? "local" : "global") as Mode,
  });

  if (p.isCancel(mode)) {
    p.outro(c.dim("Cancelled"));
    return;
  }

  // ensure repo is cloned
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

  // branch into mode-specific flow
  if (mode === "global") {
    await runGlobalMode();
  } else {
    await runLocalMode(cwd);
  }
}

// =============================================================================
// GLOBAL MODE: Symlink dotfiles to ~
// =============================================================================

async function runGlobalMode() {
  const s = p.spinner();
  s.start("Checking status...");

  // get files comparing ~ vs repo
  const files = await getAllTrackedFiles(HOME);

  // update statuses based on git remote changes
  const remoteChanges = await getRemoteChanges();
  const localChanges = await getLocalChanges();

  for (const f of files) {
    if (remoteChanges.includes(f.path) && localChanges.includes(f.path)) {
      f.status = "conflict";
    } else if (remoteChanges.includes(f.path)) {
      f.status = "remote";
    } else if (localChanges.includes(f.path)) {
      f.status = "local";
    }
  }

  s.stop("Status loaded");

  // check if all synced
  const hasChanges = files.some((f) => f.status !== "synced");
  if (!hasChanges) {
    p.log.success("Everything up to date!");
    p.outro(c.dim(`~/.dotfiles`));
    return;
  }

  // build options grouped by category
  const options: Record<string, { value: string; label: string; hint?: string }[]> = {};
  const initialValues: string[] = [];

  for (const cat of categories) {
    const catFiles = files.filter((f) => f.category === cat.name);
    if (catFiles.length === 0) continue;

    options[cat.name] = catFiles.map((f) => {
      const icon = statusIcon[f.status];

      // pre-select files that need action
      if (f.status !== "synced") {
        initialValues.push(f.path);
      }

      return {
        value: f.path,
        label: `${icon} ${f.path}`,
        hint: getGlobalHint(f.status),
      };
    });
  }

  // show legend
  p.log.message(
    c.dim(
      `${statusIcon.synced} synced  ${statusIcon.local} push  ${statusIcon.remote} pull  ${statusIcon.conflict} conflict  ${statusIcon.unlinked} link`
    )
  );

  // file selection
  const selected = await p.groupMultiselect({
    message: "Select files to sync",
    options,
    initialValues,
    required: false,
    groupSpacing: 1,
  });

  if (p.isCancel(selected) || !selected || selected.length === 0) {
    p.outro(c.dim("Nothing to do"));
    return;
  }

  const selectedFiles = selected as string[];

  // categorize by action
  const toPush: string[] = [];
  const toPull: string[] = [];
  const toLink: string[] = [];

  for (const path of selectedFiles) {
    const file = files.find((f) => f.path === path);
    if (!file) continue;

    switch (file.status) {
      case "local":
        toPush.push(path);
        break;
      case "remote":
        toPull.push(path);
        break;
      case "unlinked":
        toLink.push(path);
        break;
      case "conflict":
        // ask user for each conflict
        const action = await p.select({
          message: `${c.red("⚡")} ${path} — keep which version?`,
          options: [
            { value: "push", label: "Local", hint: "push to repo" },
            { value: "pull", label: "Remote", hint: "pull from repo" },
            { value: "skip", label: "Skip" },
          ],
        });
        if (p.isCancel(action)) continue;
        if (action === "push") toPush.push(path);
        if (action === "pull") toPull.push(path);
        break;
    }
  }

  // summary
  const summary: string[] = [];
  if (toPush.length) summary.push(`${c.yellow("↑")} Push ${toPush.length}`);
  if (toPull.length) summary.push(`${c.blue("↓")} Pull ${toPull.length}`);
  if (toLink.length) summary.push(`${c.dim("○")} Link ${toLink.length}`);

  if (summary.length === 0) {
    p.outro(c.dim("Nothing to do"));
    return;
  }

  p.log.message(summary.join("  "));

  const confirm = await p.confirm({
    message: "Proceed?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro(c.dim("Cancelled"));
    return;
  }

  // execute
  const spin = p.spinner();

  if (toPull.length) {
    spin.start("Pulling...");
    await pullRepo();
    for (const path of toPull) {
      await linkFile(path);
    }
    spin.stop(`${c.blue("↓")} Pulled ${toPull.length} files`);
  }

  if (toPush.length) {
    spin.start("Pushing...");
    for (const path of toPush) {
      await copyToRepo(path, HOME);
    }
    await pushRepo(`update ${toPush.length} files`);
    spin.stop(`${c.yellow("↑")} Pushed ${toPush.length} files`);
  }

  if (toLink.length) {
    spin.start("Linking...");
    for (const path of toLink) {
      await linkFile(path);
    }
    spin.stop(`${c.dim("○")} Linked ${toLink.length} files`);
  }

  p.outro(c.green("Done!"));
}

function getGlobalHint(status: FileStatus): string | undefined {
  switch (status) {
    case "local":
      return "push";
    case "remote":
      return "pull";
    case "unlinked":
      return "link";
    case "conflict":
      return "conflict";
    default:
      return undefined;
  }
}

// =============================================================================
// LOCAL MODE: Copy dotfiles to/from current project
// =============================================================================

async function runLocalMode(cwd: string) {
  const s = p.spinner();
  s.start("Checking status...");

  // get files comparing cwd vs repo
  const files = await getAllTrackedFiles(cwd);

  // update statuses based on git remote changes
  const remoteChanges = await getRemoteChanges();
  const localChanges = await getLocalChanges();

  for (const f of files) {
    if (remoteChanges.includes(f.path) && localChanges.includes(f.path)) {
      f.status = "conflict";
    } else if (remoteChanges.includes(f.path)) {
      f.status = "remote";
    } else if (localChanges.includes(f.path)) {
      f.status = "local";
    }
  }

  s.stop("Status loaded");

  // build options grouped by category
  const options: Record<string, { value: string; label: string; hint?: string }[]> = {};
  const initialValues: string[] = [];

  for (const cat of categories) {
    const catFiles = files.filter((f) => f.category === cat.name);
    if (catFiles.length === 0) continue;

    options[cat.name] = catFiles.map((f) => {
      const icon = statusIcon[f.status];

      // pre-select files that need action (not synced/unlinked)
      if (f.status === "local" || f.status === "remote" || f.status === "conflict") {
        initialValues.push(f.path);
      }

      return {
        value: f.path,
        label: `${icon} ${f.path}`,
        hint: getLocalHint(f.status),
      };
    });
  }

  // show legend
  p.log.message(
    c.dim(
      `${statusIcon.synced} synced  ${statusIcon.local} push  ${statusIcon.remote} pull  ${statusIcon.conflict} conflict  ${statusIcon.unlinked} copy`
    )
  );

  // file selection
  const selected = await p.groupMultiselect({
    message: "Select files",
    options,
    initialValues,
    required: false,
    groupSpacing: 1,
  });

  if (p.isCancel(selected) || !selected || selected.length === 0) {
    p.outro(c.dim("Nothing to do"));
    return;
  }

  const selectedFiles = selected as string[];

  // categorize by action
  const toPush: string[] = [];
  const toCopy: string[] = []; // copy from repo to project

  for (const path of selectedFiles) {
    const file = files.find((f) => f.path === path);
    if (!file) continue;

    switch (file.status) {
      case "local":
        // project file differs from repo → push to repo
        toPush.push(path);
        break;
      case "remote":
        // repo has newer version → copy to project
        toCopy.push(path);
        break;
      case "synced":
      case "unlinked":
        // copy from repo to project
        toCopy.push(path);
        break;
      case "conflict":
        // ask user for each conflict
        const action = await p.select({
          message: `${c.red("⚡")} ${path} — keep which version?`,
          options: [
            { value: "push", label: "Local", hint: "push to repo" },
            { value: "copy", label: "Remote", hint: "overwrite local" },
            { value: "skip", label: "Skip" },
          ],
        });
        if (p.isCancel(action)) continue;
        if (action === "push") toPush.push(path);
        if (action === "copy") toCopy.push(path);
        break;
    }
  }

  // summary
  const summary: string[] = [];
  if (toPush.length) summary.push(`${c.yellow("↑")} Push ${toPush.length}`);
  if (toCopy.length) summary.push(`${c.cyan("→")} Copy ${toCopy.length}`);

  if (summary.length === 0) {
    p.outro(c.dim("Nothing to do"));
    return;
  }

  p.log.message(summary.join("  "));

  const confirm = await p.confirm({
    message: "Proceed?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro(c.dim("Cancelled"));
    return;
  }

  // execute
  const spin = p.spinner();

  if (toPush.length) {
    spin.start("Pushing...");
    for (const path of toPush) {
      await copyToRepo(path, cwd);
    }
    await pushRepo(`update ${toPush.length} files`);
    spin.stop(`${c.yellow("↑")} Pushed ${toPush.length} files`);
  }

  if (toCopy.length) {
    spin.start("Copying...");
    for (const path of toCopy) {
      await copyFromRepo(path, cwd);
    }
    spin.stop(`${c.cyan("→")} Copied ${toCopy.length} files`);
  }

  p.outro(c.green("Done!"));
}

function getLocalHint(status: FileStatus): string | undefined {
  switch (status) {
    case "local":
      return "push";
    case "remote":
      return "pull";
    case "unlinked":
      return "copy";
    case "conflict":
      return "conflict";
    default:
      return undefined;
  }
}

// =============================================================================

main().catch((e) => {
  p.log.error(e.message);
  process.exit(1);
});
