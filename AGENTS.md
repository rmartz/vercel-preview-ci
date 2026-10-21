# Agent guide — vercel-preview-ci

This repo is the fleet's shared **label-driven Vercel preview deploy**. It ships
one reusable workflow,
[`vercel-preview.yml`](.github/workflows/vercel-preview.yml), that a Vercel-hosted
repo pins by SHA and Dependabot keeps current. The workflow deploys a preview
with the Vercel CLI only when a PR carries `UAT ready` (or the legacy
`ready for UAT`). A second reusable workflow,
[`vercel-staging.yml`](.github/workflows/vercel-staging.yml), deploys the
default branch with Preview variables to a staging alias on each push
([docs/staging.md](docs/staging.md)). See [README.md](README.md) and the
[documentation](docs/index.md).

It replaces the per-repo `preview-deploy.yml` copies and
`vercel-ignore-build.*` scripts
([rmartz/ai-tools#311](https://github.com/rmartz/ai-tools/issues/311)). It is a
standalone repo. Nothing in it depends on `ai-tools`, and nothing here is named
`ai-*`.

## This repo is CI-only and unpublished

There is no npm package. `package.json` is `private` with a frozen `0.0.0`
placeholder, and `.releaserc.json` has **no `@semantic-release/npm`**. Its one
production dependency, `vercel`, is the CLI version the workflow installs in
every consumer. That is why a `vercel` bump is a releasing `fix`. Keep it an
**exact** `x.y.z` pin in `dependencies`, never a range and never a
devDependency. Releases exist only so Dependabot can bump the `@<sha>` pins
consumers hold. **Do not** bump `package.json`'s `version` by hand.

## The golden pattern is the supported setup

The three-tier pattern (production via the Git integration, staging via
`vercel-staging.yml`, per-PR previews via `vercel-preview.yml`) is the
supported way to consume this repo. [`docs/golden-pattern.md`](docs/golden-pattern.md)
is canonical. Any change to either workflow's inputs or behavior must update
that page and its sync test,
[`test/golden-pattern.test.ts`](test/golden-pattern.test.ts), in the same PR.

## The public surface

The consumer-facing contract is the workflow's **inputs**, its `url` and
`alias-url` **outputs**,
the three secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`), the
permissions a caller must grant, the **label names**, and the sticky-comment
**marker** `<!-- vercel-preview-bot -->`. Renaming or removing any of these is a
breaking change for every consumer. Add inputs with safe defaults instead of
repurposing existing ones. Reference: [docs/consuming.md](docs/consuming.md).
`vercel-staging.yml`'s inputs, outputs, secrets and permissions are public the
same way ([docs/staging.md](docs/staging.md)), guarded by
[`test/vercel-staging-workflow.test.ts`](test/vercel-staging-workflow.test.ts).

## Invariants that must not regress

[`test/vercel-preview-workflow.test.ts`](test/vercel-preview-workflow.test.ts)
guards each of these:

- **Fork safety.** The gate requires the head repo to be this repo. The Vercel
  token must never reach fork-authored code.
- **Unrelated labels do not redeploy.** A `labeled` event deploys only when the
  label added is a UAT label. Otherwise every triage label rebuilds the same
  preview. See [docs/gating.md](docs/gating.md).
- **Concurrency stays on the job,** so a skipped event never cancels a real
  deploy.
- **The CLI version comes from `package.json` at `job.workflow_sha`,** and the
  checkout is deleted before `vercel build`.
- **`NODE_AUTH_TOKEN` on the build step and `packages: read`,** so a consumer
  whose `.npmrc` scopes GitHub Packages can install.
- **Dropping `ready for UAT`** is a `feat!` major, released only after the
  fleet rename (rmartz/dotfiles#1572) completes.

## Reusable-workflow gotcha: no `./`-local actions across the boundary

A reusable workflow's `uses: ./…` resolves against the **caller's** checkout,
not this repo's. `vercel-preview.yml` and `vercel-staging.yml` therefore each
inline their setup steps.
`.github/actions/setup` serves this repo's own CI only.

## Documentation — update it as part of every task

- **Read first.** Before editing, read the relevant `docs/` pages and this file.
- **Update in the same PR.** If a change adds, alters, or contradicts a
  documented input, gate condition, or invariant, fix the doc in the same PR.
- **Docs follow OKF.** Pages under `docs/` use OKF frontmatter and stay
  reachable from [docs/index.md](docs/index.md). The `okf`/`okf-index` checks
  enforce this. See [docs/okf-format.md](docs/okf-format.md).

## Repository conformance

This repo is held to the shared
[repository checklist](https://github.com/rmartz/ai/blob/main/docs/guidance/repository-checklist.md)
and **self-manages** its config. Fix conformance gaps directly here, in a PR.

- **Hygiene** comes from the [`repo-hygiene.yml`](.github/workflows/repo-hygiene.yml)
  caller, configured in [`.repo-hygiene.yml`](.repo-hygiene.yml).
- **PR lifecycle and auto-merge:** [`pr-lifecycle.yml`](.github/workflows/pr-lifecycle.yml)
  runs the shared `rmartz/pr-lifecycle-action` with `uat: 'off'`. It converges
  each PR's lifecycle labels, posts the `pr-lifecycle/sign-off` status pr-policy
  gates on, and arms native auto-merge only once the PR is `approved` (eligible
  Dependabot and release-please PRs included). The ruleset requires no approving
  review, so this is the approval gate for automated merges. Its `token` is a
  person's PAT (`PR_LIFECYCLE_TOKEN`), since pr-policy trusts the status only
  from a person; the merge-bot App token does every read and label write.
- **Safe merge:** [`merge-safety.yml`](.github/workflows/merge-safety.yml)
  (required check `merge-safety`).
- **PR policy:** [`pr-policy.yml`](.github/workflows/pr-policy.yml) runs the
  shared `rmartz/pr-policy-action` checks on every PR and posts the `pr-policy`
  verdict. Its `title` check validates PR titles (Conventional Commits). It
  passes `skip-uat: true` because the repo has nothing to user-test (until
  rmartz/pr-policy#85 retires it). Its trigger includes `ready_for_review` and
  `converted_to_draft`, because the title check's WIP rule depends on draft
  state, and `status`, filtered to `pr-lifecycle/sign-off`, so the gate re-runs
  when pr-lifecycle's classification lands.
  [`test/pr-policy-workflow.test.ts`](test/pr-policy-workflow.test.ts) guards both.
- **CI** ([ci.yml](.github/workflows/ci.yml)): Typecheck, Lint (actionlint,
  which also runs shellcheck on every `run:` block), Format, and Test, plus the
  post-merge commit-convention tripwire. PR titles are checked by pr-policy's
  `title` check, part of the `pr-policy` check.
- **Releases** run through the shared
  [semantic-release-ci](https://github.com/rmartz/semantic-release-ci)
  workflows: [release.yml](.github/workflows/release.yml) on push to `main`, and
  [release-check.yml](.github/workflows/release-check.yml) (required check
  `release-check / release-check`) on every PR. Never add `semantic-release` to
  `package.json`.

## Common commands

```bash
pnpm install                 # deps (run in each worktree first)
pnpm run typecheck           # tsc --noEmit
pnpm run format:check        # prettier --check
pnpm run test                # vitest: workflow contract tests
actionlint                   # the Lint job (brew install actionlint)
```

Before pushing, run `ai-pre-push-verify -C <worktree>` and fix every failure.

## Code standards

- **Strict TypeScript** in the tests. No `any`, no `@ts-ignore`.
- **Pin dependencies** to an exact `major.minor.patch`, and **SHA-pin** every
  third-party GitHub Action with a full `# vX.Y.Z` comment. A `docker://` ref
  pins `@sha256:<digest>`.
- **Shell in `run:` blocks** starts with `set -euo pipefail` when it has more
  than one command, and reads untrusted event fields (branch names, titles) via
  `env:`, never by interpolating `${{ }}` into the script.

## Worktrees, PRs, and releases

- **Work in a dedicated worktree** under `.git-worktrees/`, never on `main` in
  the root checkout.
- **PR titles must be Conventional Commits.** The repo squash-merges using the
  PR title, so it is the only subject that reaches `main`.
- **Releases are automatic.** `feat:` → minor; `fix:` / `perf:` → patch; a
  breaking `!` → major; other types do not release. The first release is
  `v1.0.0`.
- **`vercel-preview.yml` and `vercel-staging.yml` are product code, not this
  repo's CI.** A change to either
  ships to consumers, so it takes a releasing type (`feat:` / `fix:` / `perf:`),
  never `ci:`, which cuts no release. `ci:` is for this repo's **own** CI:
  `ci.yml`, `release*.yml`, `repo-hygiene.yml`, `merge-safety.yml`,
  `pr-lifecycle.yml`, `pr-policy.yml`, the tripwire, and
  `.github/actions/setup`.

## Agent directive files

- **`AGENTS.md` is the single source of truth** for agent instructions. Author
  directives here, never in `CLAUDE.md`.
- **Every `AGENTS.md` has a companion `CLAUDE.md`** (a bare `@AGENTS.md`
  import), enforced by the `md-pairing` check.
