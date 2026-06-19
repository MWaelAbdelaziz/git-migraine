/**
 * Pure migration-diff logic. No git, no fs — just set math over file lists, so
 * it is trivially unit-testable.
 */
import path from 'node:path';
import type { MigrationDiff } from './types.js';

/**
 * Keep only the files that live under `migrationsDir` and end in one of
 * `extensions`. Paths are normalised to forward slashes for cross-platform
 * comparison (git always reports forward slashes; local fs may not).
 */
export function filterMigrations(
  files: string[],
  migrationsDir: string,
  extensions: string[],
): string[] {
  const dir = normalize(migrationsDir).replace(/\/+$/, '');
  const prefix = dir === '' ? '' : `${dir}/`;
  return files
    .map(normalize)
    .filter(
      (file) =>
        (prefix === '' || file.startsWith(prefix)) &&
        extensions.some((ext) => file.endsWith(ext)),
    );
}

/**
 * Compute which migrations were added (apply) and removed (undo) going from the
 * previous commit's file list to the new commit's file list.
 *
 * `toUndo` is returned in reverse lexicographic order: sequelize-cli migration
 * filenames are timestamp-prefixed, so reverse order rolls back newest-first,
 * which is what the undo step needs.
 */
export function computeDiff(
  prevFiles: string[],
  newFiles: string[],
): MigrationDiff {
  const prev = new Set(prevFiles.map(normalize));
  const next = new Set(newFiles.map(normalize));

  const toApply = [...next].filter((file) => !prev.has(file)).sort();
  const toUndo = [...prev].filter((file) => !next.has(file)).sort().reverse();

  return { toApply, toUndo };
}

/** Migration name sequelize-cli expects: the basename without its extension. */
export function migrationName(file: string): string {
  return path.basename(file).replace(/\.[^.]+$/, '');
}

/**
 * Whether a migration name is safe to interpolate into a shell command.
 *
 * The undo command is run with a shell, and the name is derived from a filename
 * that can come from an untrusted branch. Restricting it to this conservative
 * allowlist prevents command injection (e.g. a file named `x$(rm -rf ~).cjs`).
 * Real sequelize migration names only ever use these characters.
 */
export function isSafeMigrationName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}

function normalize(file: string): string {
  // Convert Windows-style separators regardless of host platform, so a path
  // captured on Windows still matches a forward-slash migrationsDir.
  return file.replace(/\\/g, '/');
}
