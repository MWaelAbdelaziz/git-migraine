/**
 * Config loading + validation.
 *
 * Configs are discovered prettier-style via cosmiconfig from any of:
 *   - `git-migraine` key in package.json
 *   - `.git-migrainerc` / `.git-migrainerc.json` / `.git-migrainerc.{js,cjs,mjs}`
 *   - `git-migraine.config.{js,cjs,mjs}`
 *
 * The schema both validates and fills in defaults, so the rest of the codebase
 * only ever sees a fully-resolved config.
 */
import { cosmiconfig } from 'cosmiconfig';
import { z } from 'zod';
import { defaultMessages } from './messages.js';
import type { ResolvedConfig, UserConfig } from './types.js';

const commandSchema = z.object({
  command: z.string().min(1, 'command must be a non-empty string'),
});

const messagesSchema = z
  .object({
    foundChanges: z.string(),
    toApplyHeading: z.string(),
    toUndoHeading: z.string(),
    noChanges: z.string(),
    dryRunNotice: z.string(),
    undoing: z.string(),
    applying: z.string(),
    success: z.string(),
    undoFailed: z.string(),
    applyFailed: z.string(),
    restoreFailed: z.string(),
  })
  .partial();

/**
 * Schema describing what a user may put in their config file. Everything is
 * optional; `userConfigSchema` is what we expose as the `UserConfig` type.
 */
export const userConfigSchema = z
  .object({
    migrationsDir: z.string().min(1),
    extensions: z.array(z.string().min(1)).min(1),
    apply: commandSchema,
    undo: commandSchema,
    dryRun: z.boolean(),
    runOnBranchCheckoutOnly: z.boolean(),
    skipDuringRebaseOrMerge: z.boolean(),
    cwd: z.string().min(1),
    messages: messagesSchema,
  })
  .partial()
  .strict();

const defaults = {
  migrationsDir: 'src/core/migrations',
  extensions: ['.cjs'],
  apply: { command: 'npx sequelize-cli db:migrate' },
  undo: { command: 'npx sequelize-cli db:migrate:undo --name {name}' },
  dryRun: false,
  runOnBranchCheckoutOnly: true,
  skipDuringRebaseOrMerge: true,
} as const;

/**
 * The resolved schema: applies defaults so downstream code never deals with
 * `undefined`. Built by transforming the user schema.
 */
export const configSchema = userConfigSchema.transform((raw) => ({
  migrationsDir: raw.migrationsDir ?? defaults.migrationsDir,
  extensions: raw.extensions ?? [...defaults.extensions],
  apply: raw.apply ?? { ...defaults.apply },
  undo: raw.undo ?? { ...defaults.undo },
  dryRun: raw.dryRun ?? defaults.dryRun,
  runOnBranchCheckoutOnly:
    raw.runOnBranchCheckoutOnly ?? defaults.runOnBranchCheckoutOnly,
  skipDuringRebaseOrMerge:
    raw.skipDuringRebaseOrMerge ?? defaults.skipDuringRebaseOrMerge,
  cwd: raw.cwd ?? process.cwd(),
  messages: { ...defaultMessages, ...(raw.messages ?? {}) },
}));

/**
 * Identity helper that gives users typed autocomplete in their config file:
 *   import { defineConfig } from 'git-migraine';
 *   export default defineConfig({ migrationsDir: '...' });
 */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

/** Validate an already-loaded plain object into a resolved config. */
export function resolveConfig(raw: unknown): ResolvedConfig {
  return configSchema.parse(raw ?? {});
}

const MODULE_NAME = 'git-migraine';

/**
 * Discover and load the config from disk (or fall back to all-defaults).
 * `searchFrom` defaults to the current working directory.
 */
export async function loadConfig(searchFrom?: string): Promise<ResolvedConfig> {
  const explorer = cosmiconfig(MODULE_NAME, {
    searchPlaces: [
      'package.json',
      `.${MODULE_NAME}rc`,
      `.${MODULE_NAME}rc.json`,
      `.${MODULE_NAME}rc.js`,
      `.${MODULE_NAME}rc.cjs`,
      `.${MODULE_NAME}rc.mjs`,
      `${MODULE_NAME}.config.js`,
      `${MODULE_NAME}.config.cjs`,
      `${MODULE_NAME}.config.mjs`,
    ],
  });

  const result = await explorer.search(searchFrom);
  return resolveConfig(result?.config);
}
