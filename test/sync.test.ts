import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { sync } from "../src/commands/sync.js";
import { resolveConfig } from "../src/config.js";
import { ZERO_REF } from "../src/git.js";

let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execa("git", args, { cwd: repo });
  return stdout;
}

function writeMigration(name: string, body = "module.exports = {};"): void {
  const dir = path.join(repo, "migrations");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
}

/** A config whose apply/undo commands append a line to ./calls.log. */
function testConfig(extra: Record<string, unknown> = {}) {
  const log = path.join(repo, "calls.log");
  const appendApply = `node -e "require('fs').appendFileSync('${log.replace(/\\/g, "\\\\")}', 'apply\\n')"`;
  const appendUndo = `node -e "require('fs').appendFileSync('${log.replace(/\\/g, "\\\\")}', 'undo:'+process.argv[1]+'\\n')" {name}`;
  return resolveConfig({
    cwd: repo,
    migrationsDir: "migrations",
    extensions: [".cjs"],
    apply: { command: appendApply },
    undo: { command: appendUndo },
    autoMigrate: true,
    ...extra,
  });
}

function callsLog(): string[] {
  const p = path.join(repo, "calls.log");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
}

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "git-migraine-sync-"));
  await git(["init"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);
  await git(["checkout", "-b", "main"]);
  writeMigration("20240101-a.cjs");
  await git(["add", "."]);
  await git(["commit", "-m", "base migration"]);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("sync", () => {
  it("applies a migration added on the new branch", async () => {
    const oldRef = await git(["rev-parse", "HEAD"]);
    await git(["checkout", "-b", "feature"]);
    writeMigration("20240102-b.cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "add migration"]);
    const newRef = await git(["rev-parse", "HEAD"]);

    const code = await sync({
      oldRef,
      newRef,
      branchFlag: "1",
      config: testConfig(),
    });

    expect(code).toBe(0);
    expect(callsLog()).toContain("apply");
  });

  it("undoes a migration that no longer exists on the new branch", async () => {
    // feature has an extra migration; main does not.
    await git(["checkout", "-b", "feature"]);
    writeMigration("20240102-b.cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "add migration"]);
    const oldRef = await git(["rev-parse", "HEAD"]); // feature
    await git(["checkout", "main"]);
    const newRef = await git(["rev-parse", "HEAD"]); // main

    const code = await sync({
      oldRef,
      newRef,
      branchFlag: "1",
      config: testConfig(),
    });

    expect(code).toBe(0);
    expect(callsLog()).toContain("undo:20240102-b");
    // the temporarily-restored file must be cleaned up afterwards
    expect(fs.existsSync(path.join(repo, "migrations/20240102-b.cjs"))).toBe(
      false,
    );
  });

  it("does nothing on a file checkout (branchFlag 0)", async () => {
    const oldRef = await git(["rev-parse", "HEAD"]);
    await git(["checkout", "-b", "feature"]);
    writeMigration("20240102-b.cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "add migration"]);
    const newRef = await git(["rev-parse", "HEAD"]);

    const code = await sync({
      oldRef,
      newRef,
      branchFlag: "0",
      config: testConfig(),
    });
    expect(code).toBe(0);
    expect(callsLog()).toEqual([]);
  });

  it("skips on the initial checkout (zero oldRef)", async () => {
    const newRef = await git(["rev-parse", "HEAD"]);
    const code = await sync({
      oldRef: ZERO_REF,
      newRef,
      branchFlag: "1",
      config: testConfig(),
    });
    expect(code).toBe(0);
    expect(callsLog()).toEqual([]);
  });

  it("skips while a merge is in progress", async () => {
    const oldRef = await git(["rev-parse", "HEAD"]);
    await git(["checkout", "-b", "feature"]);
    writeMigration("20240102-b.cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "add migration"]);
    const newRef = await git(["rev-parse", "HEAD"]);

    // simulate a merge in progress
    const gitDirPath = await git(["rev-parse", "--git-dir"]);
    fs.writeFileSync(path.join(repo, gitDirPath, "MERGE_HEAD"), oldRef);

    const code = await sync({
      oldRef,
      newRef,
      branchFlag: "1",
      config: testConfig(),
    });
    expect(code).toBe(0);
    expect(callsLog()).toEqual([]);
  });

  it("refuses to undo a migration whose name contains shell metacharacters", async () => {
    // A malicious branch adds a migration whose name would inject a command.
    await git(["checkout", "-b", "evil"]);
    writeMigration("evil$(touch pwned).cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "sneaky migration"]);
    const oldRef = await git(["rev-parse", "HEAD"]); // evil (has the file)
    await git(["checkout", "main"]);
    const newRef = await git(["rev-parse", "HEAD"]); // main (file gone -> undo)

    const code = await sync({
      oldRef,
      newRef,
      branchFlag: "1",
      config: testConfig(),
    });

    expect(code).toBe(1); // refused
    expect(callsLog()).toEqual([]); // undo command never ran
    expect(fs.existsSync(path.join(repo, "pwned"))).toBe(false); // no injection
  });

  it("skips entirely when GIT_MIGRAINE_SKIP is set", async () => {
    const oldRef = await git(["rev-parse", "HEAD"]);
    await git(["checkout", "-b", "feature"]);
    writeMigration("20240102-b.cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "add migration"]);
    const newRef = await git(["rev-parse", "HEAD"]);

    process.env.GIT_MIGRAINE_SKIP = "1";
    try {
      const code = await sync({
        oldRef,
        newRef,
        branchFlag: "1",
        config: testConfig(),
      });
      expect(code).toBe(0);
      expect(callsLog()).toEqual([]);
    } finally {
      delete process.env.GIT_MIGRAINE_SKIP;
    }
  });

  it("dry-run reports without running commands", async () => {
    const oldRef = await git(["rev-parse", "HEAD"]);
    await git(["checkout", "-b", "feature"]);
    writeMigration("20240102-b.cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "add migration"]);
    const newRef = await git(["rev-parse", "HEAD"]);

    const code = await sync({
      oldRef,
      newRef,
      branchFlag: "1",
      dryRun: true,
      config: testConfig(),
    });
    expect(code).toBe(0);
    expect(callsLog()).toEqual([]);
  });

  it("reports without running when autoMigrate is off", async () => {
    const oldRef = await git(["rev-parse", "HEAD"]);
    await git(["checkout", "-b", "feature"]);
    writeMigration("20240102-b.cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "add migration"]);
    const newRef = await git(["rev-parse", "HEAD"]);

    const code = await sync({
      oldRef,
      newRef,
      branchFlag: "1",
      config: testConfig({ autoMigrate: false }),
    });

    expect(code).toBe(0);
    expect(callsLog()).toEqual([]); // nothing ran, only reported
  });

  it("runs migrations when autoMigrate is on", async () => {
    const oldRef = await git(["rev-parse", "HEAD"]);
    await git(["checkout", "-b", "feature"]);
    writeMigration("20240102-b.cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "add migration"]);
    const newRef = await git(["rev-parse", "HEAD"]);

    const code = await sync({
      oldRef,
      newRef,
      branchFlag: "1",
      config: testConfig({ autoMigrate: true }),
    });

    expect(code).toBe(0);
    expect(callsLog()).toContain("apply");
  });

  it("does not run even when autoMigrate is on if a dry run is requested", async () => {
    const oldRef = await git(["rev-parse", "HEAD"]);
    await git(["checkout", "-b", "feature"]);
    writeMigration("20240102-b.cjs");
    await git(["add", "."]);
    await git(["commit", "-m", "add migration"]);
    const newRef = await git(["rev-parse", "HEAD"]);

    const code = await sync({
      oldRef,
      newRef,
      branchFlag: "1",
      dryRun: true,
      config: testConfig({ autoMigrate: true }),
    });

    expect(code).toBe(0);
    expect(callsLog()).toEqual([]);
  });
});
