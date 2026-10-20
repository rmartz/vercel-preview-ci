---
type: Reference
title: A staging deploy of the default branch
description: The reusable vercel-staging.yml workflow — the production/staging/preview tier model on Vercel Hobby, the caller, its gate and concurrency, inputs and outputs, and how to set up the staging domain.
tags: [vercel, staging, environments, domains]
---

# A staging deploy of the default branch

[`vercel-staging.yml`](../.github/workflows/vercel-staging.yml) deploys the
default branch's code with the Vercel project's **Preview** environment
variables and points a stable staging hostname at it. It needs no Custom
Environments, so it works on the Hobby plan.

## The three tiers

| Tier       | Code           | Vercel environment | Deployed by                                                           |
| ---------- | -------------- | ------------------ | --------------------------------------------------------------------- |
| Production | default branch | Production         | Vercel's Git integration (unchanged)                                  |
| Staging    | default branch | Preview            | `vercel-staging.yml`, on push                                         |
| Preview    | a PR's head    | Preview            | `vercel-preview.yml`, on the UAT label ([consuming.md](consuming.md)) |

Staging and PR previews share the Preview environment, so they get the **same
variables** (for example the same `APP_ENV`). To give staging different values,
scope those variables in Vercel to the default branch: the workflow pulls with
`--git-branch=<default branch>`, so branch-scoped Preview variables apply to
staging only.

## The caller

Add `.github/workflows/staging-deploy.yml`:

```yaml
name: Staging Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  packages: read

jobs:
  staging:
    uses: rmartz/vercel-preview-ci/.github/workflows/vercel-staging.yml@<sha> # vX.Y.Z
    with:
      alias-domain: staging.example.com
    secrets: inherit
```

It takes the same three secrets as the preview workflow (see
[Secrets](consuming.md#secrets)). `packages: read` serves a consumer whose
`.npmrc` scopes GitHub Packages, as it does for previews. There is no PR, so
there is no comment and no `pull-requests` scope.

## The gate and concurrency

The job runs only when all of these hold:

- The event is `push` or `workflow_dispatch`. Any other trigger is skipped.
- The ref is the repository's default branch. A push to any other branch, or a
  manual dispatch from one, never replaces staging.
- The repository is not a fork, so a fork's pushes never deploy.

Concurrency is one group per repository, on the job, with
`cancel-in-progress`. The newest default-branch commit cancels an older deploy
still in flight, and a skipped event never joins the group.

## Inputs and outputs

| Input             | Default    | Meaning                                                                                 |
| ----------------- | ---------- | --------------------------------------------------------------------------------------- |
| `alias-domain`    | (required) | The staging hostname, for example `staging.example.com`. A bare hostname only.          |
| `node-version`    | `24.x`     | Node.js for the build. Match the Vercel project's Node.js setting.                      |
| `vercel-version`  | `''`       | Exact Vercel CLI version. Empty uses the version pinned in this repo's `package.json`.  |
| `timeout-minutes` | `10`       | Job timeout. Raise it only after measuring the build, never just to get past a timeout. |

The output `url` is the deployment's `*.vercel.app` URL, and `alias-url` is
`https://<alias-domain>`. Both are empty when the gate skipped the run, and both
go to the job summary.

## How it deploys

The build path is the preview workflow's
([How the build runs](consuming.md#how-the-build-runs)), with the default branch
checked out:

1. `vercel pull --environment=preview --git-branch=<default branch>`
2. `vercel build`
3. `vercel deploy --prebuilt`, **without `--prod`**, so it is a preview
   deployment and never touches the production domains.
4. `vercel alias set <url> <alias-domain>`

## The staging domain

1. Add the domain to the Vercel project (**Settings → Domains**) and create the
   DNS record Vercel asks for.
2. **Assign it to a placeholder Git branch that is never deployed** (for example
   `staging`). Vercel rejects the production branch as a domain's branch, and a
   domain left unassigned is a production domain: every production deploy takes
   it back, and it skips preview deployment protection. The branch **must exist
   in the connected repo**, since Vercel's domain settings reject one that
   doesn't. Push an empty branch cut from the default branch and never commit
   to it. It never deploys, because Git deploys are limited to the default
   branch (`git.deploymentEnabled` in `vercel.json`). The workflow aliases the
   domain to each staging deployment directly.

Because staging is a preview deployment, the project's preview deployment
protection (for example Vercel Authentication) applies to the staging host too.
