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

The full walkthrough, including migrating off a per-repo `preview-deploy.yml` and
`vercel-ignore-build.*` script, is in [docs/consuming.md](docs/consuming.md).

## Documentation

- [What vercel-preview-ci is](docs/overview.md)
- [Adopting it in a consuming repo](docs/consuming.md)
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
