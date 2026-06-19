/**
 * User-facing message strings. Every string is overridable via the `messages`
 * config key. Templates support `{token}` interpolation.
 *
 * Available tokens (not all are meaningful in every message):
 *   {fromBranch} {toBranch} {name} {applyCount} {undoCount}
 */
export interface Messages {
  foundChanges: string;
  toApplyHeading: string;
  toUndoHeading: string;
  noChanges: string;
  dryRunNotice: string;
  undoing: string;
  applying: string;
  success: string;
  undoFailed: string;
  applyFailed: string;
  restoreFailed: string;
}

export const defaultMessages: Messages = {
  foundChanges: '👋  git-migraine found migration changes',
  toApplyHeading: 'Migrations to apply:',
  toUndoHeading: 'Migrations to undo:',
  noChanges:
    '✅ No migration changes between {fromBranch} and {toBranch}. Nothing to do.',
  dryRunNotice: '🔍 Dry run — printing changes only, not running anything.',
  undoing: 'Rolling back: {name}',
  applying: 'Applying new migrations...',
  success:
    '✅ Migrations synced. Switched from {fromBranch} to {toBranch} ({undoCount} undone, {applyCount} applied).',
  undoFailed:
    '❌ Failed to roll back {name}. You will need to resolve this manually.',
  applyFailed: '❌ Failed to apply migrations. You will need to resolve this manually.',
  restoreFailed:
    '❌ Could not restore {name} from the previous commit, so it cannot be undone automatically.',
};

/** Replace every `{token}` in `template` with the matching value from `vars`. */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}
