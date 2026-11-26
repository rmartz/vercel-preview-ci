---
type: Reference
title: What vercel-preview-ci is
description: The gated Vercel preview model this repo centralizes, why preview deploys are limited to functional changes instead of every push, and the per-repo variants it replaces.
tags: [vercel, preview, ci]
---

# What vercel-preview-ci is

`vercel-preview-ci` ships one reusable GitHub Actions workflow,
[`vercel-preview.yml`](../.github/workflows/vercel-preview.yml). A Vercel-hosted
repo pins it by SHA, and Dependabot keeps the pin current. The workflow deploys a
Vercel **preview** for a pull request only when the PR is a functional change.
It builds the PR head with the Vercel CLI inside Actions, deploys the prebuilt
output, and posts the preview URL as one sticky PR comment that is edited in
place.

## Why gate previews

A preview exists so a person or agent can test the change. Vercel's Git
integration builds a preview on **every push to every branch**. Most of those
builds are never opened: documentation changes, CI changes, test-only changes,
Dependabot bumps, and work-in-progress pushes. Each one still costs build minutes
and deployment quota.

Under the gated model:

- Vercel's Git integration deploys **production only**. Previews are disabled
  declaratively in `vercel.json`; see
  [Disabling Git-integration previews](disabling-git-previews.md).
- A PR gets a preview when its title has a functional Conventional Commit type
  (`feat`, `fix`, `perf`, `revert`), drafts included, and is redeployed on each
  new push. The `preview` label forces one for any other PR, and `no preview`
  opts a PR out. See [The deploy gate](gating.md).
- Docs, CI, test, chore and Dependabot PRs get no preview, and marking a PR
  ready to merge it does not rebuild it. Previews are therefore built for the
  changes someone will test.

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

This repo started from the third model and, in v3, folded in the first: the
gate reads the title type instead of a UAT label. The per-repo `preview-deploy.yml`
becomes a short caller, and the `vercel-ignore-build.*` scripts become one
`vercel.json` key. Tracked in
[rmartz/ai-tools#311](https://github.com/rmartz/ai-tools/issues/311).

## What it is not

- It does not deploy production. Production stays on Vercel's Git integration for
  `main`.
- It is not a composite Action and has no first-party logic package. It wraps the
  Vercel CLI and a `gh api` comment. See [Design decisions](decisions.md).
