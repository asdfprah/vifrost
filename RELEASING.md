# Releasing

This repo publishes four independently-versioned things from one monorepo:
`vifrost/laravel` (Packagist) and `@vifrost/client`, `@vifrost/codegen`,
`@vifrost/vue` (npm). Versioning, tagging, changelogs, and publishing are all
automated with [semantic-release](https://semantic-release.gitbook.io/), driven
entirely by commit messages — nobody decides a version number by hand.

## The four release targets

| Target | Registry | Config | Tag format |
|---|---|---|---|
| `vifrost/laravel` | Packagist | `.releaserc.json` (repo root) | `v${version}` |
| `@vifrost/client` | npm | `adapters/vifrost-client/.releaserc.json` | `vifrost-client-v${version}` |
| `@vifrost/codegen` | npm | `adapters/vifrost-codegen/.releaserc.json` | `vifrost-codegen-v${version}` |
| `@vifrost/vue` | npm | `adapters/vifrost-vue/.releaserc.json` | `vifrost-vue-v${version}` |

Each has its own tag namespace specifically so they never collide with each
other (`v0.1.1` already meant "Composer release" before any of the npm
packages existed, and npm doesn't need a git tag at all — `package.json` +
the registry are its source of truth).

They're versioned **independently**, not in lockstep — a change to one
doesn't bump or republish the others. See the commit convention below for how
a commit says which target(s) it affects.

## Commit convention (mandatory, enforced)

Every commit must be `type(scope): subject`, Conventional Commits style, with
**scope required** — enforced by `commitlint.config.js`, checked both locally
(`.husky/commit-msg`, active once you've run `npm install` at the repo root)
and in CI (`.github/workflows/commitlint.yml`, on every PR — this is the check
that actually can't be bypassed).

**Scope must be exactly one of:** `client`, `codegen`, `vue`, `laravel`.

- `feat(client): ...` → minor bump for `@vifrost/client`
- `fix(codegen): ...` → patch bump for `@vifrost/codegen`
- `feat(vue)!: ...` or a `BREAKING CHANGE:` footer → major bump
- `chore(laravel): ...`, `docs(...)`, `refactor(...)`, `test(...)`, etc. →
  never trigger a release, for any target — use `chore` for repo/tooling
  changes that shouldn't publish anything (pick whichever scope is the
  closest fit; it doesn't matter which for a `chore`, since none of them
  release on `chore` regardless of scope).
- A commit scoped to one package **never** affects another's version — see
  "How scoping actually works" below.

A commit with no scope, or a scope outside these four, fails commitlint and
can't be committed (locally) or merged (CI check on the PR).

### Merge strategy matters

This only works because PRs are merged with **"Create a merge commit"**,
never squash or rebase — each individual commit lands on `master` with its
own message, so `commit-analyzer` sees them individually. If squash merging
is ever re-enabled, a squashed PR collapses to one commit using the *PR
title* as its message — meaning the PR title would need to carry the
`type(scope): ...` format instead, and a PR touching two scopes could no
longer be expressed as a single squashed commit. Repo setting: **Settings →
General → Pull Requests** — only "Allow merge commits" should be checked.

## What triggers a release

`.github/workflows/release.yml` runs on `workflow_run`, triggered only when
`.github/workflows/tests.yml` finishes **successfully** on `master` — a
release never ships on top of a failing test suite. Four jobs (one per
target) each run `npx semantic-release` scoped to their own directory and
`.releaserc.json`; a job with nothing to release for its scope is a safe
no-op (no version bump, no publish, no tag).

**They run chained (`release-laravel` → `release-client` → `release-codegen`
→ `release-vue`), not in parallel.** Every job that actually releases
something pushes a commit (and sometimes a tag) back to `master`. Running
them concurrently means whichever finishes first moves `origin/master` out
from under the others mid-run — semantic-release notices its checkout is now
behind the remote and safely refuses to publish rather than risk releasing
from stale state. Each `needs:` step's `if: always() && needs.X.result !=
'cancelled'` means one target failing (e.g. a real npm auth error) doesn't
block the next target in the chain from still getting its turn — only an
actual `cancelled` run short-circuits the rest.

## Publishing mechanism per target

- **`vifrost/laravel`**: `@semantic-release/git` commits `CHANGELOG.md` +
  pushes it, then `@semantic-release/github` creates the tag + a GitHub
  Release. Packagist picks up the new tag via its GitHub webhook (see
  "One-time setup" below) — no npm-side publish step involved.
- **npm packages**: `@semantic-release/npm` bumps `package.json` and runs
  `npm publish`, authenticated via **npm Trusted Publishing (OIDC)** — no
  `NPM_TOKEN` secret stored anywhere. Requires `permissions: id-token: write`
  on the job (already set), npm CLI ≥11.5.1 (the `npm install -g npm@latest`
  step), a Trusted Publisher configured per package on npmjs.com pointing at
  this repo + the exact workflow filename (`release.yml`), and — easy to
  miss — that Trusted Publisher's **"Allowed actions"** must explicitly
  permit "publish directly", not just the default-allowed "stage publish".
  `@semantic-release/npm` runs a plain `npm publish`, which is the "publish
  directly" action; leaving only "stage publish" allowed produces a
  confusing 403 (see "Debugging" below).
- **The three npm packages share one lockfile** (`adapters/package-lock.json`,
  npm workspaces). `@semantic-release/npm`'s `prepare` step bumps only that
  package's own `package.json`, which leaves the shared lockfile's recorded
  version for that workspace entry stale — an `@semantic-release/exec` step
  runs `npm install --package-lock-only` (from `adapters/`) right after, and
  `@semantic-release/git`'s `assets` includes `../package-lock.json`, so the
  regenerated lockfile is part of the same release commit instead of drifting
  out of sync for the *next* run to trip over.
- **`@vifrost/vue` depends on `@vifrost/client` — declare that range against
  what's actually published, never against the local workspace version.**
  `adapters/vifrost-vue/package.json`'s `peerDependencies`/`devDependencies`
  on `@vifrost/client` must be satisfiable by a version that's *actually on
  the npm registry* right now, not by whatever `adapters/vifrost-client/package.json`
  happens to say locally — those two can disagree for a while (a release can
  fail partway, bumping the local version without ever reaching npm; see
  "Debugging" below). Getting this backwards doesn't just mislead real
  installers — it blocks `@vifrost/client`'s *own* releases, since
  `@semantic-release/npm`'s `npm version` prepare step resolves the whole npm
  workspace graph and fails outright on an unsatisfiable sibling range.
  Locally, this is reconciled by `adapters/package.json`'s
  `"overrides": {"@vifrost/client": "*"}`: it keeps `vifrost-vue`'s declared
  range historically honest for real consumers while still forcing npm to
  resolve `@vifrost/client` to the local workspace symlink for everything
  *inside* this monorepo, version drift or not.

## Local dev setup

Run `npm install` once at the repo root — this runs the `prepare` script,
which activates the `commit-msg` hook (`.husky/commit-msg`) via husky. This
is per-clone, per-machine: cloning alone doesn't activate it, and there's no
way to force it centrally, which is exactly why the CI commitlint check
exists as the check that actually can't be skipped.

## Why the repo isn't reorganized into `packages/`

Packagist.org (the free/public one) doesn't support installing a package
from a subdirectory of a repo — it expects `composer.json` at the repo root.
The standard fix for that (a git subtree split via `splitsh-lite`, mirroring
`packages/laravel/` out to its own dedicated repo that Packagist tracks
instead) is real infrastructure with real risk to an already-published
package, and was deliberately deferred as a separate project, decoupled from
this release automation. Current layout — `vifrost/laravel` at the repo
root, npm packages under `adapters/` — is a consequence of that constraint,
not an oversight.

## Debugging a failed release run

`gh run list --workflow=release.yml` / `gh run view <id> --log-failed` are
the fastest way to see what actually happened — the GitHub Actions UI works
too, but the `gh` CLI puts the real stderr in front of you immediately
instead of clicking through collapsed log groups. Two bugs already found
this way, both worth checking first if a run fails again:

- **`npm ci` fails with "package.json and package-lock.json are in sync"**:
  someone edited `adapters/*/package.json` (or the root `package.json`)
  without re-running `npm install` in that same directory afterward to
  regenerate the lockfile. Fix: `npm install` there, commit the updated
  lockfile.
- **`git commit` fails inside a release job, with commitlint's own error
  text in the `stderr`**: one of the `.releaserc.json` files' `message`
  template produces a scope commitlint doesn't allow (this happened with a
  hardcoded `chore(release): ...` — `release` isn't one of the four valid
  scopes). The release commit message templates must use one of
  `client`/`codegen`/`vue`/`laravel` like everything else does.
- **`git commit` still fails after the scope is fixed, this time on
  `body-max-line-length`**: the auto-generated changelog body (full commit
  list with markdown links) routinely blows past commitlint's default
  100-char line limit — this isn't a real problem to fix in the message,
  it's commitlint linting a machine-generated commit as if a human typed it.
  `commitlint.config.js` has an `ignores` entry that skips linting entirely
  for any commit matching `^chore\((client|codegen|vue|laravel)\): release v`
  — if this fires again, check that regex still matches every
  `.releaserc.json`'s `message` template.
- **`npm run build` fails inside `release-vue` (or any job depending on
  another workspace package) with "Cannot find module '@vifrost/client'"**:
  that job only built its own package directory, not the other workspace
  packages its `dist/` type declarations depend on. Fix: build from
  `adapters/` (the `npm run build --workspaces` script, which builds in
  `workspaces` array order — `vifrost-client` first, matching its position
  in `adapters/package.json`), not from the individual package directory.
- **`npm whoami` returns 401 inside a release job's `verifyConditions`
  step**: the OIDC trusted-publishing handshake was rejected by the
  registry — almost always because the npm Trusted Publisher was never
  configured (or was misconfigured) for that package on npmjs.com. See
  "One-time setup" above; this is a registry-side config issue, not
  something fixable in this repo's files.
- **`npm publish` returns 403 "OIDC permission denied for this action"**
  (different from the 401 above — this means OIDC auth *succeeded*, but the
  registry won't let *this* action through): confirmed cause once — the
  Trusted Publisher's **"Allowed actions"** setting on npmjs.com only had
  "stage publish" enabled (the default), not "publish directly", and
  `@semantic-release/npm` always does a plain direct `npm publish`. A 401
  means "not authenticated at all"; this 403 means "authenticated, but this
  specific action isn't permitted" — check that toggle before anything else
  in this repo.
- **`npm ci` fails with "Missing: @vifrost/<package>@X.Y.Z from lock file"**
  (note: this is the *workspace package itself* missing, not a third-party
  dependency — see the first `npm ci` entry above for that variant): a
  previous release run's `@semantic-release/npm` bumped that package's
  `package.json` version and got as far as committing it, but failed before
  (or without) resyncing `adapters/package-lock.json` to match — leaving the
  lockfile recording the *old* version for that workspace entry. This is
  exactly what the `@semantic-release/exec` prepare step (see "Publishing
  mechanism per target" above) exists to prevent going forward; if it
  happens anyway, fix it the same way manually: `npm install` in `adapters/`
  to resync, commit the updated lockfile.
- **A job aborts with "The local branch master is behind the remote one,
  therefore a new version won't be published"**: another job in the chain
  pushed a commit to `master` after this job's checkout but before it
  reached that check — i.e. the jobs ran concurrently instead of chained.
  See "What triggers a release" above; the fix is the `needs:` chain
  in `release.yml`, not anything in the `.releaserc.json` files.
- **`@semantic-release/npm`'s `verify-auth.js`/`set-npmrc-auth.js` runs but
  never even logs trying OIDC, going straight to `NPM_TOKEN`/`.npmrc`
  checks**: the installed `@semantic-release/npm` doesn't support Trusted
  Publishing at all (OIDC support was added in 13.x; nothing before it has
  any OIDC code path). Worse, it can be silently *shadowed*: `semantic-release`
  (the core package) itself depends on a specific `@semantic-release/npm`
  version as one of its default bundled plugins — if that pin is older than
  what's declared at the top level, npm can't dedupe them and nests the
  older copy inside `node_modules/semantic-release/node_modules/`, which is
  the one semantic-release's plugin loader actually resolves, silently
  ignoring the newer top-level install. Check with:
  `find node_modules -path "*@semantic-release/npm/package.json"` — if
  that lists more than one path, you have this problem. Fix by bumping the
  core `semantic-release` package itself to a version whose own declared
  dependency on `@semantic-release/npm` is already 13.x+ (rather than
  fighting it with `overrides`), so both resolve to one deduped copy.
- **`npm publish` returns 422 "Error verifying sigstore provenance bundle: Failed
  to validate repository information: package.json: "repository.url" is "",
  expected to match "https://github.com/asdfprah/vifrost" from provenance"**:
  npm's registry cross-checks the GitHub Actions OIDC provenance attestation
  (which asserts which repo actually built the tarball) against the
  `repository.url` field *inside the published package.json* — none of the
  three `adapters/*/package.json` files had a `repository` field at all, so
  npm read it as an empty string and rejected the mismatch. This only surfaces
  the first time a package with a real code change actually reaches the `npm
  publish` step (`@vifrost/client` and `@vifrost/vue` didn't hit it yet in the
  run that found this, because they had nothing to release and were safe
  no-ops). Fix: add a `repository` field to each package's `package.json`:
  `{"type": "git", "url": "git+https://github.com/asdfprah/vifrost.git",
  "directory": "adapters/vifrost-<name>"}`. Gotcha: the version bump commit
  and git tag for the failed release (e.g. `vifrost-codegen-v0.2.0`) had
  *already* been created and pushed by the time `npm publish` failed —
  semantic-release tags the release commit before running the `publish` step
  plugins, not after. The npm registry never got that version, but re-running
  won't retry it: the next commit just bumps to the next patch (e.g. `0.2.1`)
  since semantic-release sees the `0.2.0` tag and considers it "already
  released" for versioning purposes, and that next version is what actually
  reaches npm.
- **Every failure above also crashes a second time in `@semantic-release/github`'s
  "fail" step**, with `Error: Variable $owner of type String! was provided
  invalid value`. This is noise on top of whatever the real failure was
  above, not a separate root cause — hasn't been tracked down further since
  it stopped mattering once the actual failures were fixed, but if it's ever
  the *only* error with no other failed step above it, that's worth
  investigating properly instead of assuming it's secondary.
- **`release-client` fails at the `npm version` step** (inside
  `@semantic-release/npm`'s `prepare`) **with `npm error code ETARGET` /
  `No matching version found for @vifrost/client@^X.Y.Z`** — note this is
  `@vifrost/client` failing to version *itself*, over a complaint that names
  `@vifrost/client`: the real cause is `adapters/vifrost-vue/package.json`
  declaring a `peerDependencies`/`devDependencies` range on `@vifrost/client`
  that no published version satisfies. `npm version` resolves the *whole* npm
  workspace graph, not just the package it's bumping, so an unsatisfiable
  sibling range blocks it outright — and since this blocks `@vifrost/client`
  from ever completing a release, the registry stays stuck exactly on the
  version that caused the mismatch in the first place, a standing deadlock
  rather than a one-off failure. This happens whenever `vifrost-vue`'s
  declared range gets bumped to match `adapters/vifrost-client/package.json`'s
  *local* version instead of what's *actually on npm* (e.g. "fixing" the
  local nested-`node_modules` shadowing bug below by bumping the range to
  match local source, without checking `npm view @vifrost/client versions`
  first). Fix: point `vifrost-vue`'s range at whatever's really published,
  then separately reconcile local linking via `adapters/package.json`'s
  `overrides` (see "Publishing mechanism per target" above) instead of ever
  bumping a declared range to chase a version that was never published.
- **A workspace package's `node_modules/@vifrost/<sibling>` is a real,
  outdated copy instead of the symlink to the local workspace package** —
  the same nested-shadowing failure mode already covered for
  `node_modules/semantic-release/node_modules/@semantic-release/npm` above,
  but between this repo's own packages: npm workspaces only symlinks a
  sibling package when the dependent's declared semver range is satisfied by
  the sibling's *local* version; if the range doesn't cover it, npm installs
  a real copy from the registry instead (whatever version does satisfy the
  range), silently shadowing local source changes in that one workspace
  package's builds/tests. Check with
  `file adapters/<package>/node_modules/@vifrost/<sibling>` — a `directory`
  means it's shadowed, a symlink (`lrwxr-xr-x` in `ls -la`) means it's fine.
  `adapters/package.json`'s `"overrides": {"@vifrost/client": "*"}` exists
  specifically to prevent this for `@vifrost/client`; if a different sibling
  package ever needs the same treatment, add it there the same way rather
  than bumping anyone's declared range to "fix" it (see the `ETARGET` entry
  above for why that backfires).
