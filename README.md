# vercel-preview-ci

Label-driven Vercel preview deploys for the fleet's Vercel-hosted repos.

Vercel's Git integration builds a preview on every push, including pushes for
documentation, CI, and test-only changes that nobody opens. This repo ships one
reusable workflow that deploys a preview **only when a PR is marked ready for
UAT**:

- A PR gets a preview when it receives the `UAT ready` label. The legacy
  `ready for UAT` is also accepted while the fleet renames it.
- It is redeployed on each new push while it keeps the label. Adding an
  unrelated label does not redeploy.
- Drafts, PRs labelled `do not merge`, and fork PRs are skipped.
- The preview URL is posted as one PR comment that is edited in place.

Production is unchanged. Vercel's Git integration keeps deploying `main`.

## Recommended setup: the golden pattern

The supported way to consume this repo is
**[the golden pattern](docs/golden-pattern.md)**: production, staging and
per-PR UAT previews, each on a host you own, on any Vercel plan. It has
copy-paste callers for both workflows and a DNS and Vercel checklist. The
quickstart below is its minimal subset, previews only.

## Quickstart

1. Add `.github/workflows/preview-deploy.yml`:

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
       secrets: inherit # VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
   ```

2. Turn off Git-integration previews in `vercel.json`, keeping production:

   ```json
   {
     "git": {
       "deploymentEnabled": { "main": true, "**": false }
     }
   }
   ```

3. Make sure `.github/dependabot.yml` has a `github-actions` entry so the pin
   stays current.

### Optional: a per-PR preview hostname

Set `alias-domain` to a host built from the PR number, and each UAT deploy
points that PR's own host at its new preview. Auth allowlists (OAuth redirect
URIs, Firebase authorized domains) can then name hosts you own instead of all of
`vercel.app`, and the sticky comment leads with the PR's host. Nothing changes
when the input is unset.

```yaml
jobs:
  preview:
    uses: rmartz/vercel-preview-ci/.github/workflows/vercel-preview.yml@<sha> # vX.Y.Z
    with:
      alias-domain: pr-${{ github.event.pull_request.number }}.preview.example.com
    secrets: inherit
```

This needs a wildcard domain (`*.preview.example.com`) on the Vercel project.
See [A per-PR preview hostname](docs/consuming.md#a-per-pr-preview-hostname) and
the [golden pattern](docs/golden-pattern.md) checklist. A stable staging host is
the job of [`vercel-staging.yml`](docs/staging.md), not of the preview workflow.

The full walkthrough, including migrating off a per-repo `preview-deploy.yml` and
`vercel-ignore-build.*` script, is in [docs/consuming.md](docs/consuming.md).

## Staging

A second reusable workflow, `vercel-staging.yml`, deploys the default branch
with the Preview environment variables on each push, and aliases it to a
staging hostname. With production and PR previews that gives three tiers, all on
the Hobby plan. See [docs/staging.md](docs/staging.md).

## Documentation

- [The golden pattern](docs/golden-pattern.md) (recommended setup)
- [What vercel-preview-ci is](docs/overview.md)
- [Adopting it in a consuming repo](docs/consuming.md)
- [A staging deploy of the default branch](docs/staging.md)
- [The deploy gate](docs/gating.md)
- [Disabling Git-integration previews](docs/disabling-git-previews.md)
- [Design decisions](docs/decisions.md)

## Development

This repo is CI-only and unpublished. The tests check the workflow's contracts.

```bash
pnpm install
pnpm run test
pnpm run typecheck
pnpm run format:check
```

See [AGENTS.md](AGENTS.md) for the contributor guide.
