# git-migraine

> A cure for migration headaches. See — and optionally **apply** and **undo** —
> the Sequelize migrations that change when you switch git branches.

When you check out a branch that added migrations, git-migraine tells you which
ones to apply. When you go back to a branch that doesn't have them, it tells you
which to roll back. No more "did I forget a migration?" and no more dirty local
DBs after branch hopping.

By default it is **report-only** (`autoMigrate: false`): it just prints the
migrations to apply and undo, leaving your database untouched. Flip
`autoMigrate: true` and it will run them for you — restoring each removed
migration file from the previous commit first so `sequelize-cli` can undo it
cleanly.

It works by diffing the migration files between the commit you left and the
commit you landed on, then either reporting or running your configured
apply/undo commands.

## Install

```bash
npm install --save-dev git-migraine
```

Then set everything up with one command:

```bash
npx git-migraine init
```

`init` is idempotent (safe to re-run) and does four things:

1. **Installs the `post-checkout` hook** where git actually reads hooks — it
   honours `core.hooksPath`, so it lands in [husky](https://typicode.github.io/husky/)'s
   path when husky is active, a custom hooks path, or `.git/hooks` otherwise.
2. **Scaffolds a config file** (`.git-migrainerc.json`) if you don't have one,
   pre-filled with a detected migrations folder.
3. **Adds a `prepare` script** to `package.json` so teammates get the hook
   automatically on `npm install` — nobody else has to run `init`.
4. **Adds a `git sco <branch>` alias** for checking out without running
   migrations (see [Skipping a checkout](#skipping-a-checkout)).

It prints a summary of what changed and which files to commit (the hook under
`.husky/`, the config, and `package.json` are tracked — commit them to share
with your team).

### Requirements

- **git** and **Node 18+** on the machine that runs the hook.
- Your migration CLI must be runnable from the configured commands — if it lives
  in a container, point the commands at it (see
  [Running migrations inside Docker](#running-migrations-inside-docker)).

## Configure

git-migraine reads config prettier-style via
[cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) — a `git-migraine` key
in `package.json`, a `.git-migrainerc.json`, or a `git-migraine.config.js`:

```js
// git-migraine.config.js
import { defineConfig } from 'git-migraine';

export default defineConfig({
  migrationsDir: 'src/migrations',
  extensions: ['.cjs', '.js'],
  apply: { command: 'npx sequelize-cli db:migrate' },
  undo: { command: 'npx sequelize-cli db:migrate:undo --name {name}' },
  autoMigrate: false,
  showMigrations: true,
});
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `migrationsDir` | `src/core/migrations` | Folder (relative to repo root) holding migration files. |
| `extensions` | `['.cjs']` | File extensions that count as migrations. |
| `apply.command` | `npx sequelize-cli db:migrate` | Command run once to apply pending migrations. |
| `undo.command` | `npx sequelize-cli db:migrate:undo --name {name}` | Command run per removed migration. `{name}` is the migration's basename without extension. |
| `autoMigrate` | `false` | When `true`, automatically run the apply/undo commands on a branch switch. When `false` (the default), git-migraine **only shows** the migrations to apply and undo — it never touches your database. |
| `showMigrations` | `true` | Print the lists of migrations to apply/undo on each branch switch. Set to `false` for silent operation. |
| `dryRun` | `false` | Force report-only even when `autoMigrate` is `true`. Also available via `--dry-run`. |
| `runOnBranchCheckoutOnly` | `true` | Ignore file checkouts (`git checkout <file>`); only act on branch switches. |
| `skipDuringRebaseOrMerge` | `true` | Don't run mid rebase/merge — only on the final settled checkout. |
| `cwd` | `process.cwd()` | Repo root to operate in. |
| `messages` | built-in | Override any user-facing string (templates support `{fromBranch}`, `{toBranch}`, `{name}`, `{applyCount}`, `{undoCount}`). |

### Customizing messages

Every line git-migraine prints can be overridden via the `messages` key — handy
for translating, rewording, or adding your own team flavor. Override only the
ones you want; the rest keep their defaults.

```json
{
  "migrationsDir": "src/core/migrations",
  "messages": {
    "foundChanges": "🚀 Syncing migrations...",
    "success": "Done — {undoCount} undone, {applyCount} applied ({fromBranch} → {toBranch})."
  }
}
```

| Key | Shown when | Tokens |
| --- | --- | --- |
| `foundChanges` | changes are detected | — |
| `toApplyHeading` / `toUndoHeading` | listing the changed files | — |
| `noChanges` | nothing to do | `{fromBranch}` `{toBranch}` |
| `applying` | before applying new migrations | — |
| `undoing` | before rolling back each migration | `{name}` |
| `success` | everything synced | `{fromBranch}` `{toBranch}` `{applyCount}` `{undoCount}` |
| `dryRunNotice` | running with `--dry-run` (or `dryRun: true`) | — |
| `showOnlyNotice` | `autoMigrate` is off and changes were found | — |
| `applyFailed` / `undoFailed` / `restoreFailed` | a step fails | `{name}` |

### Running migrations inside Docker

If your CLI runs in a container (like the original setup this is based on), just
point the commands at it:

```js
export default defineConfig({
  migrationsDir: 'src/core/migrations',
  apply: { command: 'docker exec -i app npx sequelize-cli db:migrate' },
  undo: { command: 'docker exec -i app npx sequelize-cli db:migrate:undo --name {name}' },
});
```

## CLI

```
git-migraine sync <oldRef> <newRef> <branchFlag> [--dry-run]   # called by the hook
git-migraine init                                              # install the hook
git-migraine doctor                                            # check config + env
```

## Skipping a checkout

Sometimes you want to switch branches without touching your database. Two ways:

```bash
git sco some-branch                    # the alias `init` installs
GIT_MIGRAINE_SKIP=1 git checkout some-branch   # the underlying switch
```

Either one checks out the branch normally but tells git-migraine to do nothing
for that one checkout. A normal `git checkout` still syncs migrations as usual.

## How undo works

`sequelize-cli db:migrate:undo --name <name>` needs the migration file present
on disk. When a migration was removed on the branch you're switching to, its
file is gone — so git-migraine restores it from the previous commit into the
migrations folder, runs the undo, then deletes the temporary file. Undos run
newest-first.

## Security — trust boundary

> **Only enable git-migraine in repositories whose branches you trust.**

The `post-checkout` hook runs `git-migraine sync` automatically and silently
after **every branch switch**, and it reads its config (and therefore the
`apply` / `undo` commands) from the **working tree of the branch you just
checked out** — not from a fixed, trusted location:

- The `apply` / `undo` commands are executed via a shell, so a branch that ships
  a `.git-migrainerc.json` with a hostile `apply.command` can run arbitrary
  commands on your machine the moment you check it out.
- Config is discovered via cosmiconfig, which **imports** JavaScript config
  files (`git-migraine.config.js`, `.git-migrainerc.cjs`, etc.). A branch
  containing a malicious JS config executes arbitrary code on checkout — even
  with no migration changes at all.

In practice this means: **do not check out an untrusted branch (e.g. a pull
request from a fork) into a working tree where git-migraine's hook is
installed.** Doing so hands that branch code execution under your user account.
This is the same property that JS-config tools like Prettier and ESLint have,
except git-migraine runs unattended on checkout rather than only when you invoke
it. Set `GIT_MIGRAINE_SKIP=1` (or use the `git sco` alias `init` installs) to
check out a branch without triggering the hook.

## Notes & limitations

- Non-interactive by design: it prints the changes and runs them. Use
  `--dry-run` to preview.
- To restore a removed migration so `sequelize-cli` can undo it, git-migraine
  briefly writes the file back into your migrations folder and then deletes it.
  If an **untracked** file already sits at that exact path, it will be
  overwritten and removed. Keep untracked files out of your migrations folder.
- It does not check whether a migration was actually applied in your database
  before applying/undoing — it trusts the git diff.
- v1 targets `sequelize-cli`, but `apply`/`undo` are just command templates, so
  other runners can work with custom commands.

## License

MIT
