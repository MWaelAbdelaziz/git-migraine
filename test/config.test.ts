import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { defaultMessages } from '../src/messages.js';

describe('resolveConfig', () => {
  it('fills in defaults for an empty config', () => {
    const config = resolveConfig({});
    expect(config.migrationsDir).toBe('src/core/migrations');
    expect(config.extensions).toEqual(['.cjs']);
    expect(config.apply.command).toContain('sequelize-cli db:migrate');
    expect(config.undo.command).toContain('{name}');
    expect(config.dryRun).toBe(false);
    expect(config.skipDuringRebaseOrMerge).toBe(true);
  });

  it('accepts undefined as all-defaults', () => {
    expect(resolveConfig(undefined).migrationsDir).toBe('src/core/migrations');
  });

  it('overrides defaults with user values', () => {
    const config = resolveConfig({
      migrationsDir: 'db/migrations',
      extensions: ['.js'],
      apply: { command: 'docker exec -i app npx sequelize-cli db:migrate' },
    });
    expect(config.migrationsDir).toBe('db/migrations');
    expect(config.extensions).toEqual(['.js']);
    expect(config.apply.command).toContain('docker exec');
    // untouched fields still default
    expect(config.undo.command).toContain('{name}');
  });

  it('merges custom messages over the defaults', () => {
    const config = resolveConfig({ messages: { foundChanges: 'custom!' } });
    expect(config.messages.foundChanges).toBe('custom!');
    expect(config.messages.success).toBe(defaultMessages.success);
  });

  it('rejects unknown keys', () => {
    expect(() => resolveConfig({ nope: true })).toThrow();
  });

  it('rejects an empty command', () => {
    expect(() => resolveConfig({ apply: { command: '' } })).toThrow();
  });

  it('rejects an empty extensions array', () => {
    expect(() => resolveConfig({ extensions: [] })).toThrow();
  });
});
