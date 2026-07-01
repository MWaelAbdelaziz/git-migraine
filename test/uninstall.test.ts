import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { init } from '../src/commands/init.js';
import { uninstall } from '../src/commands/uninstall.js';

let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd: repo });
  return stdout;
}

const hookPath = () => path.join(repo, '.git/hooks/post-checkout');

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-migraine-uninstall-'));
  await git(['init']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('uninstall', () => {
  it('deletes the hook file when git-migraine created the whole thing', async () => {
    await init({ cwd: repo });
    expect(fs.existsSync(hookPath())).toBe(true);

    await uninstall({ cwd: repo });

    expect(fs.existsSync(hookPath())).toBe(false);
  });

  it('removes only the injected block from a pre-existing hook', async () => {
    fs.writeFileSync(hookPath(), '#!/bin/sh\necho "my own hook"\n');
    await init({ cwd: repo }); // appends the git-migraine block

    await uninstall({ cwd: repo });

    const hook = fs.readFileSync(hookPath(), 'utf8');
    expect(hook).toContain('echo "my own hook"'); // user's hook stays
    expect(hook).not.toContain('# >>> git-migraine >>>'); // our block gone
    expect(hook).not.toContain('node_modules/.bin/git-migraine');
  });

  it('removes the git sco alias', async () => {
    await init({ cwd: repo });
    expect(await git(['config', '--get', 'alias.sco'])).toContain(
      'GIT_MIGRAINE_SKIP',
    );

    await uninstall({ cwd: repo });

    await expect(git(['config', '--get', 'alias.sco'])).rejects.toThrow();
  });

  it('drops the git-migraine entry from the prepare script but keeps the rest', async () => {
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { prepare: 'husky' } }, null, 2),
    );
    await init({ cwd: repo }); // prepare → "husky && git-migraine init"

    await uninstall({ cwd: repo });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(repo, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts.prepare).toBe('husky');
  });

  it('removes the prepare key entirely when git-migraine was its only entry', async () => {
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { build: 'tsc' } }, null, 2),
    );
    await init({ cwd: repo }); // prepare → "git-migraine init"

    await uninstall({ cwd: repo });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(repo, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts.prepare).toBeUndefined();
    expect(pkg.scripts.build).toBe('tsc'); // untouched
  });

  it('leaves the user config file in place', async () => {
    await init({ cwd: repo }); // scaffolds .git-migrainerc.json
    await uninstall({ cwd: repo });
    expect(fs.existsSync(path.join(repo, '.git-migrainerc.json'))).toBe(true);
  });

  it('is a no-op when nothing was installed', async () => {
    const code = await uninstall({ cwd: repo });
    expect(code).toBe(0);
    expect(fs.existsSync(hookPath())).toBe(false);
  });

  it('undoes init cleanly so re-running init still works', async () => {
    await init({ cwd: repo });
    await uninstall({ cwd: repo });
    await init({ cwd: repo });

    const hook = fs.readFileSync(hookPath(), 'utf8');
    expect(hook.match(/# >>> git-migraine >>>/g)?.length).toBe(1);
  });
});
