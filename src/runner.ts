/**
 * Executes the user-configured apply / undo commands.
 *
 * Commands are plain shell strings (so `docker exec -i app npx sequelize-cli ...`
 * works as-is). The undo command may contain a `{name}` token which is replaced
 * with the migration name before running.
 */
import { execa } from 'execa';
import { interpolate } from './messages.js';

export interface RunResult {
  ok: boolean;
  exitCode: number;
}

/** Run a shell command string, streaming its output to the parent stdio. */
export async function runCommand(
  command: string,
  cwd: string,
): Promise<RunResult> {
  try {
    await execa(command, {
      cwd,
      shell: true,
      stdio: 'inherit',
    });
    return { ok: true, exitCode: 0 };
  } catch (error) {
    const exitCode =
      typeof error === 'object' &&
      error !== null &&
      'exitCode' in error &&
      typeof error.exitCode === 'number'
        ? error.exitCode
        : 1;
    return { ok: false, exitCode };
  }
}

/** Run the apply command verbatim. */
export function runApply(command: string, cwd: string): Promise<RunResult> {
  return runCommand(command, cwd);
}

/** Run the undo command with `{name}` interpolated to the migration name. */
export function runUndo(
  command: string,
  name: string,
  cwd: string,
): Promise<RunResult> {
  return runCommand(interpolate(command, { name }), cwd);
}
