/**
 * Public types for git-migraine configuration.
 *
 * The runtime source of truth is the zod schema in `config.ts`; these types are
 * derived from it so consumers get accurate autocomplete via `defineConfig`.
 */
import type { z } from 'zod';
import type { configSchema, userConfigSchema } from './config.js';

/** Fully-resolved config (every field present), used internally after loading. */
export type ResolvedConfig = z.infer<typeof configSchema>;

/** What a user may write in their config file — everything optional with defaults. */
export type UserConfig = z.input<typeof userConfigSchema>;

/** The set of migration files added/removed between two commits. */
export interface MigrationDiff {
  /** Files present in the new commit but not the old one — run "apply". */
  toApply: string[];
  /** Files present in the old commit but not the new one — run "undo". */
  toUndo: string[];
}
