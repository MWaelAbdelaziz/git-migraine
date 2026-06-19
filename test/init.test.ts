import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { init } from '../src/commands/init.js';

let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd: repo });
  return stdout;
}

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-migraine-init-'));
  await git(['init']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('init', () => {
  it('installs a raw hook into .git/hooks when there is no husky', async () => {
    await init({ cwd: repo });
    const hook = fs.readFileSync(
      path.join(repo, '.git/hooks/post-checkout'),
      'utf8',
    );
    expect(hook).toContain('git-migraine sync');
    expect(hook).toContain('# >>> git-migraine >>>');
  });

  it('installs into .husky/post-checkout when core.hooksPath points at husky', async () => {
    fs.mkdirSync(path.join(repo, '.husky/_'), { recursive: true });
    await git(['config', 'core.hooksPath', '.husky/_']);

    await init({ cwd: repo });

    const hook = fs.readFileSync(
      path.join(repo, '.husky/post-checkout'),
      'utf8',
    );
    expect(hook).toContain('npx git-migraine sync');
    // must NOT pollute the husky wrappers dir
    expect(fs.existsSync(path.join(repo, '.husky/_/post-checkout'))).toBe(false);
  });

  it('scaffolds a config when none exists and detects the migrations dir', async () => {
    fs.mkdirSync(path.join(repo, 'db/migrations'), { recursive: true });
    await init({ cwd: repo });
    const cfg = JSON.parse(
      fs.readFileSync(path.join(repo, '.git-migrainerc.json'), 'utf8'),
    );
    expect(cfg.migrationsDir).toBe('db/migrations');
  });

  it('does not overwrite an existing config', async () => {
    fs.writeFileSync(
      path.join(repo, '.git-migrainerc.json'),
      JSON.stringify({ migrationsDir: 'custom/path' }),
    );
    await init({ cwd: repo });
    const cfg = JSON.parse(
      fs.readFileSync(path.join(repo, '.git-migrainerc.json'), 'utf8'),
    );
    expect(cfg.migrationsDir).toBe('custom/path');
  });

  it('adds a prepare script to package.json', async () => {
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { build: 'tsc' } }, null, 2),
    );
    await init({ cwd: repo });
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repo, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts.prepare).toContain('git-migraine init');
    expect(pkg.scripts.build).toBe('tsc'); // existing scripts preserved
  });

  it('appends to an existing prepare script without clobbering it', async () => {
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { prepare: 'husky' } }, null, 2),
    );
    await init({ cwd: repo });
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repo, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts.prepare).toBe('husky && git-migraine init');
  });

  it('adds the skip alias', async () => {
    await init({ cwd: repo });
    const alias = await git(['config', '--get', 'alias.sco']);
    expect(alias).toBe('!GIT_MIGRAINE_SKIP=1 git checkout');
  });

  it('is idempotent — re-running does not duplicate the hook or prepare', async () => {
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: {} }, null, 2),
    );
    await init({ cwd: repo });
    await init({ cwd: repo });

    const hook = fs.readFileSync(
      path.join(repo, '.git/hooks/post-checkout'),
      'utf8',
    );
    expect(hook.match(/git-migraine sync/g)?.length).toBe(1);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(repo, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts.prepare).toBe('git-migraine init');
  });
});
