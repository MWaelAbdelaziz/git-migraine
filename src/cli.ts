/**
 * git-migraine CLI.
 *
 * Commands:
 *   git-migraine sync <oldRef> <newRef> <branchFlag> [--dry-run]
 *       The post-checkout entry point. Wired up by `init`.
 *   git-migraine init
 *       Install the post-checkout hook (husky-aware).
 *   git-migraine uninstall
 *       Reverse init: remove the hook block, alias, and prepare entry.
 *   git-migraine doctor
 *       Validate config + environment.
 */
import pc from 'picocolors';
import { sync } from './commands/sync.js';
import { init } from './commands/init.js';
import { uninstall } from './commands/uninstall.js';
import { doctor } from './commands/doctor.js';

const HELP = `${pc.bold('git-migraine')} — branch-aware Sequelize migrations

${pc.bold('Usage:')}
  git-migraine sync <oldRef> <newRef> <branchFlag> [--dry-run]
  git-migraine init
  git-migraine uninstall
  git-migraine doctor

${pc.bold('Commands:')}
  sync       Apply/undo migrations for a branch switch (called by the git hook)
  init       Install the post-checkout git hook (uses husky if present)
  uninstall  Remove the hook, alias, and prepare entry that init added
  doctor     Check configuration and environment

${pc.bold('Flags:')}
  --dry-run   Print what would change without running any migrations
  -h, --help  Show this help
  -v, --version  Show version
`;

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    return 0;
  }
  if (args.includes('-v') || args.includes('--version')) {
    console.log(await version());
    return 0;
  }

  const [command, ...rest] = args;

  switch (command) {
    case 'sync': {
      const dryRun = rest.includes('--dry-run');
      const positional = rest.filter((a) => !a.startsWith('-'));
      const [oldRef, newRef, branchFlag] = positional;
      if (!oldRef || !newRef) {
        console.error(
          pc.red('sync requires <oldRef> <newRef> <branchFlag> (passed by the git hook).'),
        );
        return 2;
      }
      return sync({ oldRef, newRef, branchFlag: branchFlag ?? '1', dryRun });
    }
    case 'init':
      return init();
    case 'uninstall':
      return uninstall();
    case 'doctor':
      return doctor();
    default:
      console.error(pc.red(`Unknown command: ${command}\n`));
      console.log(HELP);
      return 2;
  }
}

async function version(): Promise<string> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

main(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
