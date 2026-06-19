/**
 * Thin wrappers around the git commands git-migraine needs. Everything runs
 * through execa against the given `cwd`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';

export const ZERO_REF = '0000000000000000000000000000000000000000';

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execa('git', args, { cwd });
  return stdout;
}

/** List every tracked file in a commit (recursive, paths relative to repo root). */
export async function listFilesAtCommit(
  ref: string,
  cwd: string,
): Promise<string[]> {
  const stdout = await git(['ls-tree', '-r', '--name-only', ref], cwd);
  return stdout.split('\n').filter((line) => line.length > 0);
}

/** Read a single file's contents as it existed at a commit. */
export async function showFileAtCommit(
  ref: string,
  file: string,
  cwd: string,
): Promise<string> {
  return git(['show', `${ref}:${file}`], cwd);
}

/** Current branch name, or the short SHA when detached. */
export async function currentBranch(cwd: string): Promise<string> {
  const name = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (name !== 'HEAD') return name;
  return git(['rev-parse', '--short', 'HEAD'], cwd).catch(() => 'HEAD');
}

/** Best-effort human-readable name for an arbitrary ref/commit. */
export async function refName(ref: string, cwd: string): Promise<string> {
  if (ref === ZERO_REF) return '(none)';
  try {
    const name = await git(['name-rev', '--name-only', ref], cwd);
    return name.split('^')[0] ?? ref.slice(0, 7);
  } catch {
    return ref.slice(0, 7);
  }
}

/** Absolute path to the repo's git dir (handles worktrees and `.git` files). */
export async function gitDir(cwd: string): Promise<string> {
  const dir = await git(['rev-parse', '--git-dir'], cwd);
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

/**
 * The value of `core.hooksPath`, or undefined when it is not set. This is where
 * git actually reads hooks from (e.g. `.husky/_` when husky is active), so it
 * is the source of truth for deciding where to install our hook.
 */
export async function getHooksPath(cwd: string): Promise<string | undefined> {
  try {
    const value = await git(['config', '--get', 'core.hooksPath'], cwd);
    return value.trim() || undefined;
  } catch {
    return undefined; // unset → git uses the default .git/hooks
  }
}

/** Set a local git alias (lives in .git/config, not committed). */
export async function setLocalAlias(
  name: string,
  command: string,
  cwd: string,
): Promise<void> {
  await execa('git', ['config', `alias.${name}`, command], { cwd });
}

/** Read an existing local git alias value, if any. */
export async function getLocalAlias(
  name: string,
  cwd: string,
): Promise<string | undefined> {
  try {
    return (await git(['config', '--get', `alias.${name}`], cwd)).trim();
  } catch {
    return undefined;
  }
}

/**
 * True while a rebase or merge is mid-flight. During a rebase, post-checkout
 * can fire once per replayed commit; we want to act only on the final settled
 * state, so callers skip when this returns true.
 */
export async function isRebaseOrMergeInProgress(cwd: string): Promise<boolean> {
  let dir: string;
  try {
    dir = await gitDir(cwd);
  } catch {
    return false;
  }
  return (
    fs.existsSync(path.join(dir, 'rebase-merge')) ||
    fs.existsSync(path.join(dir, 'rebase-apply')) ||
    fs.existsSync(path.join(dir, 'MERGE_HEAD')) ||
    fs.existsSync(path.join(dir, 'CHERRY_PICK_HEAD'))
  );
}
