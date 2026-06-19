import { describe, expect, it } from 'vitest';
import { runApply, runCommand, runUndo } from '../src/runner.js';

const cwd = process.cwd();

describe('runner', () => {
  it('runs a successful command', async () => {
    const result = await runCommand('node -e "process.exit(0)"', cwd);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('reports a non-zero exit code without throwing', async () => {
    const result = await runCommand('node -e "process.exit(3)"', cwd);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });

  it('runApply runs the command verbatim', async () => {
    const result = await runApply('node -e "process.exit(0)"', cwd);
    expect(result.ok).toBe(true);
  });

  it('runUndo interpolates {name} into the command', async () => {
    // The command echoes the name and asserts it was substituted.
    const result = await runUndo(
      'node -e "process.exit(process.argv[1] === \'mymig\' ? 0 : 1)" {name}',
      'mymig',
      cwd,
    );
    expect(result.ok).toBe(true);
  });
});
