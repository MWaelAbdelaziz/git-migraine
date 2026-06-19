/**
 * `git-migraine sync <oldRef> <newRef> <branchFlag>` — the post-checkout brain.
 *
 * Git invokes the post-checkout hook with the previous HEAD, the new HEAD, and
 * a flag that is 1 for a branch checkout and 0 for a file checkout. We diff the
 * migration files between the two commits and apply/undo the difference.
 */
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import type { ResolvedConfig } from '../types.js';
import { loadConfig } from '../config.js';
import {
  computeDiff,
  filterMigrations,
  isSafeMigrationName,
  migrationName,
} from '../diff.js';
import {
  ZERO_REF,
  currentBranch,
  isRebaseOrMergeInProgress,
  listFilesAtCommit,
  refName,
  showFileAtCommit,
} from './../git.js';
import { interpolate } from '../messages.js';
import { runApply, runUndo } from '../runner.js';

export interface SyncArgs {
  oldRef: string;
  newRef: string;
  /** The third post-checkout arg: '1' branch checkout, '0' file checkout. */
  branchFlag: string;
  /** Force dry-run regardless of config (the `--dry-run` flag). */
  dryRun?: boolean;
  /** Override the loaded config (used by tests). */
  config?: ResolvedConfig;
}

/**
 * True when the user asked to skip this checkout via `GIT_MIGRAINE_SKIP`.
 * Accepts `1`, `true`, or `yes` (case-insensitive); `0`/empty means run.
 */
function isSkipRequested(): boolean {
  const value = process.env.GIT_MIGRAINE_SKIP?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export async function sync(args: SyncArgs): Promise<number> {
  const config = args.config ?? (await loadConfig());
  const cwd = config.cwd;
  const dryRun = args.dryRun || config.dryRun;
  const msg = config.messages;

  // ── Guard rails ───────────────────────────────────────────────
  if (isSkipRequested()) {
    console.log(pc.dim('⏭  GIT_MIGRAINE_SKIP set — skipping migration sync.'));
    return 0; // user opted out of this checkout
  }
  if (config.runOnBranchCheckoutOnly && args.branchFlag !== '1') {
    return 0; // file checkout, not a branch switch
  }
  if (args.oldRef === ZERO_REF) {
    return 0; // first checkout / fresh clone
  }
  if (
    config.skipDuringRebaseOrMerge &&
    (await isRebaseOrMergeInProgress(cwd))
  ) {
    return 0; // mid rebase/merge — act only once it settles
  }

  // ── Diff migrations between the two commits ───────────────────
  const [prevAll, newAll] = await Promise.all([
    listFilesAtCommit(args.oldRef, cwd),
    listFilesAtCommit(args.newRef, cwd),
  ]);
  const prev = filterMigrations(prevAll, config.migrationsDir, config.extensions);
  const next = filterMigrations(newAll, config.migrationsDir, config.extensions);
  const { toApply, toUndo } = computeDiff(prev, next);

  const [fromBranch, toBranch] = await Promise.all([
    refName(args.oldRef, cwd),
    currentBranch(cwd),
  ]);
  const vars = {
    fromBranch,
    toBranch,
    applyCount: toApply.length,
    undoCount: toUndo.length,
  };

  if (toApply.length === 0 && toUndo.length === 0) {
    console.log(pc.green(interpolate(msg.noChanges, vars)));
    return 0;
  }

  // ── Report ────────────────────────────────────────────────────
  console.log(`\n${pc.bold(msg.foundChanges)}`);
  if (toUndo.length > 0) {
    console.log(`\n${pc.red(msg.toUndoHeading)}`);
    for (const file of toUndo) console.log(pc.red(`  - ${file}`));
  }
  if (toApply.length > 0) {
    console.log(`\n${pc.green(msg.toApplyHeading)}`);
    for (const file of toApply) console.log(pc.green(`  + ${file}`));
  }

  if (dryRun) {
    console.log(`\n${pc.yellow(interpolate(msg.dryRunNotice, vars))}`);
    return 0;
  }

  // ── Undo removed migrations (newest first, fail-fast) ─────────
  if (toUndo.length > 0) {
    const exitCode = await undoMigrations(toUndo, args.oldRef, config);
    if (exitCode !== 0) return exitCode;
  }

  // ── Apply new migrations ──────────────────────────────────────
  if (toApply.length > 0) {
    console.log(`\n${msg.applying}`);
    const result = await runApply(config.apply.command, cwd);
    if (!result.ok) {
      console.error(pc.red(interpolate(msg.applyFailed, vars)));
      return result.exitCode || 1;
    }
  }

  console.log(`\n${pc.green(interpolate(msg.success, vars))}`);
  return 0;
}

/**
 * Roll back each removed migration. sequelize-cli can only undo a migration
 * whose file is present on disk, so we restore each file from the old commit,
 * run the undo command, then remove the temporary file again.
 */
async function undoMigrations(
  toUndo: string[],
  oldRef: string,
  config: ResolvedConfig,
): Promise<number> {
  const { cwd, messages: msg } = config;
  const migrationsRoot = path.resolve(cwd, config.migrationsDir);

  for (const file of toUndo) {
    const name = migrationName(file);
    const absPath = path.resolve(cwd, file);

    // Security: the name is interpolated into a shell command, and the path is
    // written/removed on disk. Both derive from a filename that can come from
    // an untrusted branch, so refuse anything that isn't a plain migration.
    const inside =
      absPath === migrationsRoot ||
      absPath.startsWith(migrationsRoot + path.sep);
    if (!isSafeMigrationName(name) || !inside) {
      console.error(
        pc.red(
          `Refusing to undo unsafe migration path "${file}". ` +
            `Resolve it manually.`,
        ),
      );
      return 1;
    }

    let contents: string;
    try {
      contents = await showFileAtCommit(oldRef, file, cwd);
    } catch {
      console.error(pc.red(interpolate(msg.restoreFailed, { name })));
      return 1;
    }

    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, contents);

    console.log(pc.red(interpolate(msg.undoing, { name })));
    const result = await runUndo(config.undo.command, name, cwd);

    // Always remove the temporarily-restored file, even on failure.
    fs.rmSync(absPath, { force: true });

    if (!result.ok) {
      console.error(pc.red(interpolate(msg.undoFailed, { name })));
      return result.exitCode || 1;
    }
  }

  return 0;
}
