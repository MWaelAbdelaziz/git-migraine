/**
 * `git-migraine uninstall` — the exact reverse of `init`. It exists so removal
 * is a single explicit step instead of hunting through git internals by hand.
 *
 * It:
 *   1. Removes the managed `post-checkout` hook block (deleting the file if we
 *      created it and nothing else remains).
 *   2. Drops the `git-migraine init` entry from the `prepare` script.
 *   3. Removes the `git sco` alias (only if it is still ours).
 *   4. Leaves your config file in place (it is yours) and points it out.
 *
 * Every step is idempotent and best-effort, mirroring `init`: one failing step
 * never aborts the others. After this, `npm uninstall git-migraine` is a no-op.
 */
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { getLocalAlias, resolveHookTarget, unsetLocalAlias } from "../git.js";

const MARKER_START = "# >>> git-migraine >>>";
const MARKER_END = "# <<< git-migraine <<<";
const PREPARE_CALL = "git-migraine init";
const SKIP_ALIAS = "sco";
const SKIP_ALIAS_CMD = "!GIT_MIGRAINE_SKIP=1 git checkout";

const CONFIG_FILES = [
  "git-migraine.config.js",
  "git-migraine.config.cjs",
  "git-migraine.config.mjs",
  ".git-migrainerc",
  ".git-migrainerc.json",
  ".git-migrainerc.js",
  ".git-migrainerc.cjs",
];

export interface UninstallArgs {
  cwd?: string;
}

/** What a step did, for the end-of-run summary. */
interface StepResult {
  message: string;
  /** A repo-relative path git will want committed, if this step changed one. */
  tracked?: string;
}

export async function uninstall(args: UninstallArgs = {}): Promise<number> {
  const cwd = args.cwd ?? process.cwd();
  const results: StepResult[] = [];
  const warnings: string[] = [];

  await safe(() => removeHook(cwd, results), warnings, "remove hook");
  safeSync(
    () => removePrepareScript(cwd, results),
    warnings,
    "remove prepare script",
  );
  await safe(() => removeSkipAlias(cwd, results), warnings, "remove skip alias");
  safeSync(() => noteLeftoverConfig(cwd, results), warnings, "check config");

  printSummary(results, warnings);
  return 0;
}

// ── 1. Remove the managed hook block ────────────────────────────────

async function removeHook(cwd: string, results: StepResult[]): Promise<void> {
  const { file } = await resolveHookTarget(cwd);
  const rel = path.relative(cwd, file);

  if (!fs.existsSync(file)) {
    results.push({ message: `No hook at ${rel} (nothing to remove)` });
    return;
  }

  const existing = fs.readFileSync(file, "utf8");
  if (!existing.includes(MARKER_START)) {
    results.push({ message: `No git-migraine block in ${rel} (left untouched)` });
    return;
  }

  // Strip our block plus any blank line that surrounded it.
  const stripped = existing
    .replace(
      new RegExp(
        `\\n*${escapeRe(MARKER_START)}[\\s\\S]*?${escapeRe(MARKER_END)}\\n?`,
      ),
      "\n",
    )
    .replace(/\n{3,}/g, "\n\n");

  // If nothing meaningful is left (blank, or only a shebang we wrote), the whole
  // hook was ours — delete the file. Otherwise keep the user's own hook.
  if (isEffectivelyEmpty(stripped)) {
    fs.rmSync(file, { force: true });
    results.push({ message: `Removed hook → ${rel}` });
  } else {
    fs.writeFileSync(file, `${stripped.trimEnd()}\n`);
    results.push({
      message: `Removed git-migraine block from ${rel} (your hook preserved)`,
      tracked: rel.startsWith(".husky/") ? rel : undefined,
    });
  }
}

/** True when the only remaining lines are blank or a shebang. */
function isEffectivelyEmpty(content: string): boolean {
  return content
    .split("\n")
    .map((line) => line.trim())
    .every((line) => line.length === 0 || line.startsWith("#!"));
}

// ── 2. Remove the prepare-script entry ──────────────────────────────

function removePrepareScript(cwd: string, results: StepResult[]): void {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const current: unknown = pkg.scripts?.prepare;
  if (typeof current !== "string" || !current.includes(PREPARE_CALL)) return;

  // Drop our segment; `prepare` is a `&&`-joined chain (e.g. "husky && ...").
  const next = current
    .split("&&")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== PREPARE_CALL)
    .join(" && ");

  if (next.length > 0) {
    pkg.scripts.prepare = next;
  } else {
    delete pkg.scripts.prepare;
  }

  // Preserve trailing newline style of the original file.
  const trailing = raw.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}${trailing}`);
  results.push({
    message: `Removed "${PREPARE_CALL}" from the package.json "prepare" script`,
    tracked: "package.json",
  });
}

// ── 3. Remove the skip alias ────────────────────────────────────────

async function removeSkipAlias(
  cwd: string,
  results: StepResult[],
): Promise<void> {
  const existing = await getLocalAlias(SKIP_ALIAS, cwd);
  if (existing !== SKIP_ALIAS_CMD) return; // absent or user-owned → leave it
  await unsetLocalAlias(SKIP_ALIAS, cwd);
  results.push({ message: `Removed alias → "git ${SKIP_ALIAS}"` });
}

// ── 4. Point out the config we intentionally leave behind ───────────

function noteLeftoverConfig(cwd: string, results: StepResult[]): void {
  const found = CONFIG_FILES.find((f) => fs.existsSync(path.join(cwd, f)));
  if (found) {
    results.push({
      message: `Left your config file ${found} in place — delete it manually if you no longer need it`,
    });
  }
}

// ── Summary ─────────────────────────────────────────────────────────

function printSummary(results: StepResult[], warnings: string[]): void {
  console.log(pc.bold("\ngit-migraine has been removed:\n"));
  for (const r of results) console.log(`  ${pc.green("✓")} ${r.message}`);

  const tracked = results.map((r) => r.tracked).filter(Boolean);
  if (tracked.length > 0) {
    console.log(pc.bold("\nCommit these so your team gets the removal:"));
    for (const t of tracked) console.log(pc.cyan(`  ${t}`));
  }

  for (const w of warnings) console.log(`\n${pc.yellow("!")} ${w}`);

  console.log(
    pc.dim("\nDone. You can now run: npm uninstall git-migraine"),
  );
}

// ── helpers ─────────────────────────────────────────────────────────

async function safe(
  fn: () => Promise<void>,
  warnings: string[],
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    warnings.push(`Could not ${label}: ${errMsg(error)}`);
  }
}

function safeSync(fn: () => void, warnings: string[], label: string): void {
  try {
    fn();
  } catch (error) {
    warnings.push(`Could not ${label}: ${errMsg(error)}`);
  }
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
