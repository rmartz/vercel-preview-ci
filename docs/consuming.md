---
type: Reference
title: Adopting vercel-preview-ci in a consuming repo
description: The caller workflow, the secrets and permissions it needs, the inputs and output, keeping the pin current with Dependabot, and the checklist for migrating a repo off its own preview-deploy.yml and Ignored Build Step script.
tags: [vercel, preview, consuming, migration, dependabot]
---

# Adopting vercel-preview-ci in a consuming repo

## The caller

Add `.github/workflows/preview-deploy.yml`:

```yaml
name: Preview Deploy

on:
  pull_request:
    types: [labeled, unlabeled, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  packages: read
  pull-requests: write

jobs:
  preview:
    uses: rmartz/vercel-preview-ci/.github/workflows/vercel-preview.yml@<sha> # vX.Y.Z
    secrets: inherit
```

Replace `<sha>` with the commit of the latest
[release](https://github.com/rmartz/vercel-preview-ci/releases), and keep the
full `# vX.Y.Z` comment so Dependabot can bump it.

- **Triggers:** subscribe to all five activity types. The workflow's gate decides
  which events deploy (see [The deploy gate](gating.md)). Use `pull_request`,
  not `pull_request_target`. The gate rejects anything else.
- **Permissions:** a called workflow can only narrow the caller's grant, so the
  caller must grant all three. `pull-requests: write` posts the comment.
  `packages: read` lets the build install a GitHub Packages dependency if the
  repo's `.npmrc` scopes one; it is harmless otherwise.
- **No `concurrency:` block.** Concurrency is set per PR inside the workflow. A
  workflow-level group in the caller would let a skipped event cancel a real
  deploy.

## Secrets

`secrets: inherit` passes three repository Actions secrets:

| Secret              | Value                                                            |
| ------------------- | ---------------------------------------------------------------- |
| `VERCEL_TOKEN`      | A Vercel access token with access to the project's team.         |
| `VERCEL_ORG_ID`     | `orgId` from `.vercel/project.json` (run `vercel link` locally). |
| `VERCEL_PROJECT_ID` | `projectId` from `.vercel/project.json`.                         |

The job fails with a clear error if any of them is missing. Repos that already
ran a per-repo `preview-deploy.yml` have them set.

A run that **Dependabot** triggers (for example, its rebase of a labelled PR)
receives only Dependabot secrets and a read-only token. Such a run fails at the
secrets check unless the three secrets are also set with
`gh secret set <name> --app dependabot`. If they are set, the preview deploys,
but the comment step is skipped because the token cannot write. The URL is still
in the job summary and the `url` output. A run started by a person labelling a
Dependabot PR is an ordinary run and comments as usual. Dependabot bumps rarely
need UAT, so most repos can leave the Dependabot secrets unset.

## Inputs and output

| Input             | Default | Meaning                                                                                 |
| ----------------- | ------- | --------------------------------------------------------------------------------------- |
| `node-version`    | `24.x`  | Node.js for the build. Match the Vercel project's Node.js setting.                      |
| `vercel-version`  | `''`    | Exact Vercel CLI version. Empty uses the version pinned in this repo's `package.json`.  |
| `timeout-minutes` | `10`    | Job timeout. Raise it only after measuring the build, never just to get past a timeout. |

The workflow output `url` is the preview URL (empty when the gate skipped). A
downstream job in the caller can use it, for example for end-to-end tests:

```yaml
e2e:
  needs: preview
  if: needs.preview.outputs.url != ''
  # ... run tests against ${{ needs.preview.outputs.url }}
```

## How the build runs

The job checks out the PR head, sets up Node.js, and sets up pnpm when the repo
has a `pnpm-lock.yaml` (the version comes from the repo's `packageManager`
field). npm repos need nothing extra. It then runs:

1. `vercel pull --environment=preview --git-branch=<head branch>`, which fetches
   the project settings and the preview environment variables, including
   branch-scoped ones.
2. `vercel build`, which runs the project's own install and build commands from
   its Vercel settings or `vercel.json`.
3. `vercel deploy --prebuilt`, which uploads the build output.

The repo's `.github/actions/setup` is **not** used. The build is whatever Vercel
would run, so the preview matches a real Vercel build.

## Keeping the pin current

The repo's `.github/dependabot.yml` needs a `github-actions` entry. That entry
bumps this workflow's `@<sha>` pin with each release. Each Vercel CLI bump in
this repo is a release, so consumers receive CLI updates through the same pin.

## Migrating a repo that has its own preview-deploy.yml

1. Replace the body of `.github/workflows/preview-deploy.yml` with the caller
   above.
2. Turn off Git-integration previews in `vercel.json` and delete the
   `ignoreCommand` key and the `scripts/vercel-ignore-build.*` script (plus any
   `lib/` helpers and tests used only by it). See
   [Disabling Git-integration previews](disabling-git-previews.md).
3. Remove docs and `AGENTS.md` notes that describe the old guard, such as
   "Vercel preview deploys are gated by branch prefix."
4. Leave the existing sticky comment alone. The workflow uses the same
   `<!-- vercel-preview-bot -->` marker, so it edits that comment in place.
5. Verify the change with the steps in
   [Disabling Git-integration previews](disabling-git-previews.md#verifying-it).

The three Vercel secrets need no change; a repo that ran its own
`preview-deploy.yml` already has them. Check that `.github/dependabot.yml` has a
`github-actions` entry. Without one, the new `@<sha>` pin is never bumped (see
[Keeping the pin current](#keeping-the-pin-current)).
