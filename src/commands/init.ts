/**
 * `git-migraine init` — one command that wires everything up so the end user
 * never has to touch git config, hooks, or aliases by hand.
 *
 * It:
 *   1. Installs the post-checkout hook where git *actually* reads hooks
 *      (honours core.hooksPath — husky's path, a custom path, or .git/hooks).
 *   2. Scaffolds a starter config file if none exists.
 *   3. Adds a `prepare` script so teammates get the hook on `npm install`.
 *   4. Adds a `git sco` alias for checking out without running migrations.
 *
 * Every step is idempotent and best-effort: one failing step never aborts the
 * others. At the end it prints a summary, including which files git will want
 * committed (relevant because hooks under `.husky/` are tracked).
 */
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { getHooksPath, getLocalAlias, gitDir, setLocalAlias } from "../git.js";

const HOOK_CALL = 'npx git-migraine sync "$1" "$2" "$3"';
const MARKER_START = "# >>> git-migraine >>>";
const MARKER_END = "# <<< git-migraine <<<";
const MANAGED_BLOCK = `${MARKER_START}\n${HOOK_CALL}\n${MARKER_END}`;
const PREPARE_CALL = "git-migraine init";
const SKIP_ALIAS = "sco";
const SKIP_ALIAS_CMD = "!GIT_MIGRAINE_SKIP=1 git checkout";

const CONFIG_CANDIDATES = [
  "src/core/migrations",
  "src/migrations",
  "migrations",
  "db/migrations",
  "database/migrations",
];

export interface InitArgs {
  cwd?: string;
}

/** What a step did, for the end-of-run summary. */
interface StepResult {
  message: string;
  /** A repo-relative path git will want committed, if this step created one. */
  tracked?: string;
}

export async function init(args: InitArgs = {}): Promise<number> {
  const cwd = args.cwd ?? process.cwd();
  const results: StepResult[] = [];
  const warnings: string[] = [];

  await safe(
    () => installHook(cwd, results, warnings),
    warnings,
    "install hook",
  );
  safeSync(() => scaffoldConfig(cwd, results), warnings, "scaffold config");
  safeSync(
    () => addPrepareScript(cwd, results),
    warnings,
    "add prepare script",
  );
  await safe(() => addSkipAlias(cwd, results), warnings, "add skip alias");

  printSummary(results, warnings);
  return 0;
}

// ── 1. Install the hook where git actually reads hooks ──────────────

async function installHook(
  cwd: string,
  results: StepResult[],
  warnings: string[],
): Promise<void> {
  const hooksPath = await getHooksPath(cwd);
  const huskyActive = isHuskyHooksPath(hooksPath);

  if (huskyActive) {
    // husky reads wrappers from `.husky/_`; the user hook lives in `.husky/`.
    const file = path.join(cwd, ".husky", "post-checkout");
    writeHuskyHook(file);
    results.push({
      message: `Installed hook → ${path.relative(cwd, file)} (husky)`,
      tracked: path.relative(cwd, file),
    });
    return;
  }

  // Raw hook: install into whatever dir git reads (core.hooksPath or default).
  const dir = hooksPath
    ? path.resolve(cwd, hooksPath)
    : path.join(await gitDir(cwd), "hooks");
  const file = path.join(dir, "post-checkout");
  writeRawHook(file);

  const rel = path.relative(cwd, file);
  results.push({ message: `Installed hook → ${rel}` });

  // If husky is present but not the active hooks path, the hook still works
  // (we installed where git reads) but warn so they understand the setup.
  if (!huskyActive && huskyInstalled(cwd)) {
    warnings.push(
      `husky is installed but core.hooksPath is "${hooksPath ?? "(default .git/hooks)"}". ` +
        `Installed the hook there so it fires. To use husky's shared hooks instead, run:\n` +
        `    git config core.hooksPath .husky/_   then re-run git-migraine init`,
    );
  }
}

function writeHuskyHook(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (existing.includes(HOOK_CALL)) return; // idempotent
  const next =
    existing.trim().length > 0
      ? `${existing.trimEnd()}\n${HOOK_CALL}\n`
      : `${HOOK_CALL}\n`;
  fs.writeFileSync(file, next);
  fs.chmodSync(file, 0o755);
}

function writeRawHook(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";

  let next: string;
  if (existing.includes(MARKER_START)) {
    next = existing.replace(
      new RegExp(`${escapeRe(MARKER_START)}[\\s\\S]*?${escapeRe(MARKER_END)}`),
      MANAGED_BLOCK,
    );
  } else if (existing.trim().length > 0) {
    next = `${existing.trimEnd()}\n\n${MANAGED_BLOCK}\n`;
  } else {
    next = `#!/bin/sh\n${MANAGED_BLOCK}\n`;
  }
  fs.writeFileSync(file, next);
  fs.chmodSync(file, 0o755);
}

// ── 2. Scaffold a starter config ────────────────────────────────────

function scaffoldConfig(cwd: string, results: StepResult[]): void {
  if (hasConfig(cwd)) return;

  const migrationsDir =
    CONFIG_CANDIDATES.find((dir) => fs.existsSync(path.join(cwd, dir))) ??
    "migrations";

  const config = {
    migrationsDir,
    extensions: [".cjs"],
    apply: { command: "npx sequelize-cli db:migrate" },
    undo: { command: "npx sequelize-cli db:migrate:undo --name {name}" },
    autoMigrate: false,
    showMigrations: true,
  };

  const file = path.join(cwd, ".git-migrainerc.json");
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  results.push({
    message: `Created config → .git-migrainerc.json (migrationsDir: ${migrationsDir})`,
    tracked: ".git-migrainerc.json",
  });
}

// ── 3. Add a prepare script for team auto-install ───────────────────

function addPrepareScript(cwd: string, results: StepResult[]): void {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  pkg.scripts ??= {};

  const current: string | undefined = pkg.scripts.prepare;
  if (current?.includes(PREPARE_CALL)) return; // idempotent

  pkg.scripts.prepare = current
    ? `${current} && ${PREPARE_CALL}`
    : PREPARE_CALL;

  // Preserve trailing newline style of the original file.
  const trailing = raw.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}${trailing}`);
  results.push({
    message: `Added "prepare": "...${PREPARE_CALL}" to package.json (teammates auto-install on npm install)`,
    tracked: "package.json",
  });
}

// ── 4. Add the skip alias ───────────────────────────────────────────

async function addSkipAlias(cwd: string, results: StepResult[]): Promise<void> {
  const existing = await getLocalAlias(SKIP_ALIAS, cwd);
  if (existing === SKIP_ALIAS_CMD) return; // idempotent
  if (existing && existing !== SKIP_ALIAS_CMD) {
    results.push({
      message: `Skipped alias: "git ${SKIP_ALIAS}" already exists (left untouched)`,
    });
    return;
  }
  await setLocalAlias(SKIP_ALIAS, SKIP_ALIAS_CMD, cwd);
  results.push({
    message: `Added alias → "git ${SKIP_ALIAS} <branch>" checks out without running migrations`,
  });
}

// ── Summary ─────────────────────────────────────────────────────────

function printSummary(results: StepResult[], warnings: string[]): void {
  console.log(pc.bold("\ngit-migraine is set up:\n"));
  for (const r of results) console.log(`  ${pc.green("✓")} ${r.message}`);

  const tracked = results.map((r) => r.tracked).filter(Boolean);
  if (tracked.length > 0) {
    console.log(pc.bold("\nCommit these so your team gets them:"));
    for (const t of tracked) console.log(pc.cyan(`  ${t}`));
  }

  for (const w of warnings) console.log(`\n${pc.yellow("!")} ${w}`);

  console.log(
    pc.dim("\nDone. Switch branches as usual and migrations stay in sync."),
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function isHuskyHooksPath(hooksPath: string | undefined): boolean {
  if (!hooksPath) return false;
  const normalized = hooksPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.endsWith(".husky/_") || normalized.endsWith(".husky");
}

function huskyInstalled(cwd: string): boolean {
  if (fs.existsSync(path.join(cwd, ".husky"))) return true;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    );
    return Boolean(pkg.devDependencies?.husky || pkg.dependencies?.husky);
  } catch {
    return false;
  }
}

function hasConfig(cwd: string): boolean {
  const files = [
    "git-migraine.config.js",
    "git-migraine.config.cjs",
    "git-migraine.config.mjs",
    ".git-migrainerc",
    ".git-migrainerc.json",
    ".git-migrainerc.js",
    ".git-migrainerc.cjs",
  ];
  if (files.some((f) => fs.existsSync(path.join(cwd, f)))) return true;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    );
    return pkg["git-migraine"] !== undefined;
  } catch {
    return false;
  }
}

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
