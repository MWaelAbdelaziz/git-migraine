/**
 * `git-migraine doctor` — sanity-check the environment before relying on the
 * hook. Prints the resolved config and verifies git + the migrations dir.
 */
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { execa } from 'execa';
import { loadConfig } from '../config.js';

export async function doctor(): Promise<number> {
  const config = await loadConfig();
  let ok = true;

  console.log(pc.bold('git-migraine doctor\n'));

  // git available?
  try {
    const { stdout } = await execa('git', ['--version']);
    line(true, stdout);
  } catch {
    line(false, 'git not found on PATH');
    ok = false;
  }

  // inside a git repo?
  try {
    await execa('git', ['rev-parse', '--is-inside-work-tree'], { cwd: config.cwd });
    line(true, 'inside a git work tree');
  } catch {
    line(false, `not a git repository: ${config.cwd}`);
    ok = false;
  }

  // migrations dir present?
  const migrationsPath = path.join(config.cwd, config.migrationsDir);
  if (fs.existsSync(migrationsPath)) {
    line(true, `migrations dir: ${config.migrationsDir}`);
  } else {
    line(false, `migrations dir not found: ${config.migrationsDir}`);
    ok = false;
  }

  console.log('');
  console.log(pc.dim('Resolved config:'));
  console.log(
    pc.dim(
      JSON.stringify(
        {
          migrationsDir: config.migrationsDir,
          extensions: config.extensions,
          apply: config.apply,
          undo: config.undo,
          autoMigrate: config.autoMigrate,
          showMigrations: config.showMigrations,
          dryRun: config.dryRun,
          runOnBranchCheckoutOnly: config.runOnBranchCheckoutOnly,
          skipDuringRebaseOrMerge: config.skipDuringRebaseOrMerge,
        },
        null,
        2,
      ),
    ),
  );

  return ok ? 0 : 1;
}

function line(pass: boolean, text: string): void {
  console.log(`  ${pass ? pc.green('✓') : pc.red('✗')} ${text}`);
}
