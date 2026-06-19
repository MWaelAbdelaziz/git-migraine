import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { gitDir, isRebaseOrMergeInProgress } from '../src/git.js';

let repo: string;

async function git(args: string[]): Promise<void> {
  await execa('git', args, { cwd: repo });
}

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-migraine-'));
  await git(['init']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello');
  await git(['add', '.']);
  await git(['commit', '-m', 'init']);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('isRebaseOrMergeInProgress', () => {
  it('is false in a clean repo', async () => {
    expect(await isRebaseOrMergeInProgress(repo)).toBe(false);
  });

  it('is true when MERGE_HEAD exists', async () => {
    const dir = await gitDir(repo);
    fs.writeFileSync(path.join(dir, 'MERGE_HEAD'), 'deadbeef');
    expect(await isRebaseOrMergeInProgress(repo)).toBe(true);
  });

  it('is true when a rebase-merge dir exists', async () => {
    const dir = await gitDir(repo);
    fs.mkdirSync(path.join(dir, 'rebase-merge'), { recursive: true });
    expect(await isRebaseOrMergeInProgress(repo)).toBe(true);
  });

  it('is false outside any git repo', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    try {
      expect(await isRebaseOrMergeInProgress(tmp)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
