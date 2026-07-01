/**
 * Public programmatic API for git-migraine.
 *
 * Most users only need `defineConfig` in their config file, but the building
 * blocks are exported for advanced/embedded use.
 */
export { defineConfig, loadConfig, resolveConfig } from './config.js';
export { sync } from './commands/sync.js';
export { init } from './commands/init.js';
export { uninstall } from './commands/uninstall.js';
export { doctor } from './commands/doctor.js';
export {
  computeDiff,
  filterMigrations,
  isSafeMigrationName,
  migrationName,
} from './diff.js';
export { defaultMessages, interpolate } from './messages.js';
export type { Messages } from './messages.js';
export type {
  ResolvedConfig,
  UserConfig,
  MigrationDiff,
} from './types.js';
