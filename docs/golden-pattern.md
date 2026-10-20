---
type: Reference
title: The golden pattern — production, staging and per-PR previews
description: The supported way to consume vercel-preview-ci. Three tiers (production, staging, per-PR UAT previews) on custom hosts, with copy-paste caller workflows, the vercel.json setting, a DNS and Vercel setup checklist, and the known limits. Works on the Hobby plan.
tags: [vercel, golden-pattern, staging, preview, domains, dns, consuming]
---

# The golden pattern

This is the supported way to consume `vercel-preview-ci`. It gives a Vercel
project three tiers, each on a host you own, on any plan including Hobby. It
needs no Custom Environments and no paid Preview Deployment Suffix.

| Tier       | Code           | Vercel environment | Host                         | Deployed by                                          |
| ---------- | -------------- | ------------------ | ---------------------------- | ---------------------------------------------------- |
| Production | default branch | Production         | `app.example.com`            | Vercel's Git integration, default branch only        |
| Staging    | default branch | Preview            | `staging.example.com`        | [`vercel-staging.yml`](staging.md), on each push     |
| Preview    | a PR's head    | Preview            | `pr-<N>.preview.example.com` | [`vercel-preview.yml`](consuming.md), on `UAT ready` |

The callers below are checked against the workflows' declared inputs and
permissions by
[`test/golden-pattern.test.ts`](../test/golden-pattern.test.ts), so they stay
valid as the workflows change.

## Why custom hosts

OAuth redirect URIs and auth-provider allowlists (Firebase authorized domains,
for example, where one entry covers its subdomains) can then name hosts you own.
The alternative is allowing `vercel.app`, which trusts every Vercel deployment
of every project. Testers also get stable, readable URLs.

## The callers

Replace `<sha>` with the commit of the latest
[release](https://github.com/rmartz/vercel-preview-ci/releases), and keep the
full `# vX.Y.Z` comment so Dependabot can bump it.

### `vercel.json`: production from the default branch only

```json
{
  "git": {
    "deploymentEnabled": { "main": true, "**": false }
  }
}
```

Vercel's Git integration keeps deploying production. Every other branch is
deployed only by the two workflows (see
[Disabling Git-integration previews](disabling-git-previews.md)).

### `.github/workflows/preview-deploy.yml`: per-PR UAT previews

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
    with:
      alias-domain: pr-${{ github.event.pull_request.number }}.preview.example.com
    secrets: inherit # VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
```

### `.github/workflows/staging-deploy.yml`: staging from the default branch

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
    secrets: inherit # VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
```

## Setup checklist

**Secrets.** Set `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as
repository Actions secrets (see [Secrets](consuming.md#secrets)).

**DNS**, at your DNS provider:

- [ ] A CNAME for the production host (`app.example.com`) to Vercel.
- [ ] A CNAME for the staging host (`staging.example.com`) to Vercel.
- [ ] A wildcard CNAME for `*.preview.example.com` to Vercel.
- [ ] An NS delegation of `_acme-challenge.preview.example.com` to
      `ns1.vercel-dns.com` and `ns2.vercel-dns.com`. Vercel issues the wildcard
      certificate through a DNS challenge, so it must answer for that name.

Use the CNAME target Vercel shows for each domain.

**Vercel**, in the project's **Settings → Domains**:

- [ ] Add the production host as a production domain.
- [ ] Add `staging.example.com` and `*.preview.example.com`, and **assign both
      to a placeholder Git branch that is never deployed** (for example
      `staging`). The workflows alias these hosts to deployments directly, so
      the branch never needs to exist. Vercel rejects the production branch as
      a domain's branch, and a domain left unassigned is a production domain:
      production deploys take it back, and it skips preview deployment
      protection.
- [ ] Wait until each domain shows as verified with a certificate.

**Allowlists:** add the production, staging and preview hosts to each auth
provider's allowlist.

**Labels:** make sure the repo has the `UAT ready` label.

**Dependabot:** make sure `.github/dependabot.yml` has a `github-actions` entry
so both pins stay current.

## Known limits

- **Staging and previews share the Preview environment,** so APP_ENV-style
  variables are identical in both. To tell them apart, scope those variables to
  the default branch in Vercel. The staging workflow pulls with
  `--git-branch=<default branch>`, so branch-scoped values reach staging only.
- **Per-PR aliases stay after the PR closes.** The alias keeps pointing at that
  PR's last preview. Cleanup is tracked in
  [rmartz/vercel-preview-ci#4](https://github.com/rmartz/vercel-preview-ci/issues/4).
- **Preview deployment protection applies to staging,** since staging is a
  preview deployment.
