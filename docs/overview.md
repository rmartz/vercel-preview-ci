---
type: Reference
title: What vercel-preview-ci is
description: The label-driven Vercel preview model this repo centralizes, why preview deploys are gated on a UAT label instead of every push, and the per-repo variants it replaces.
tags: [vercel, preview, uat, ci]
---

# What vercel-preview-ci is

`vercel-preview-ci` ships one reusable GitHub Actions workflow,
[`vercel-preview.yml`](../.github/workflows/vercel-preview.yml). A Vercel-hosted
repo pins it by SHA, and Dependabot keeps the pin current. The workflow deploys a
Vercel **preview** for a pull request only when the PR is marked ready for UAT.
It builds the PR head with the Vercel CLI inside Actions, deploys the prebuilt
output, and posts the preview URL as one sticky PR comment that is edited in
place.

## Why gate previews on a label

A preview exists so a person can do user-acceptance testing (UAT). Vercel's Git
integration builds a preview on **every push to every branch**. Most of those
builds are never opened: documentation changes, CI changes, test-only changes,
Dependabot bumps, and work-in-progress pushes. Each one still costs build minutes
and deployment quota.

Under the label-driven model:

- Vercel's Git integration deploys **production only**. Previews are disabled
  declaratively in `vercel.json`; see
  [Disabling Git-integration previews](disabling-git-previews.md).
- A PR gets a preview when it receives the `UAT ready` label (the legacy
  `ready for UAT` is also accepted during the rename). It is redeployed on each
  new push while it keeps the label. See [The deploy gate](gating.md).
- The review flow applies that label only to PRs that need a human to test them
  (`/review` applies `UAT ready` or `no UAT needed`). Previews are therefore
  built for the changes that need one.

## What it replaces

Before this repo existed, each Vercel repo had its own copy of the gating, and
the copies had drifted into three policies:

- **Title heuristic:** an Ignored Build Step script that allowed a preview only
  for `feat`/`fix` PR titles (firebase-nextjs-template, trip-split).
- **Branch prefix:** an Ignored Build Step that allowed `feat/` and `fix/`
  branches (hidden-role-game). That repo also ran the label workflow, so a
  labelled PR got **two** previews per push.
- **Label-driven:** Git-integration previews skipped by the Ignored Build Step,
  plus a per-repo `preview-deploy.yml` (group-picks, trip-planner,
  personal-budget).

This repo standardizes the third model. The per-repo `preview-deploy.yml`
becomes a short caller, and the `vercel-ignore-build.*` scripts become one
`vercel.json` key. Tracked in
[rmartz/ai-tools#311](https://github.com/rmartz/ai-tools/issues/311).

## What it is not

- It does not deploy production. Production stays on Vercel's Git integration for
  `main`.
- It is not a composite Action and has no first-party logic package. It wraps the
  Vercel CLI and a `gh api` comment. See [Design decisions](decisions.md).
