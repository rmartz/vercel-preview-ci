---
type: Design
title: Design decisions
description: Why the product is a reusable workflow and not a composite Action, why the build runs in Actions with the Vercel CLI, where the CLI version is pinned, and why Git-integration previews are disabled declaratively.
tags: [design, decisions, reusable-workflow, vercel-cli]
---

# Design decisions

## A reusable workflow, not a composite Action

The fleet's `-action` repos wrap an `@rmartz/<name>` package in a composite
Action. This repo has no such package; it wraps the Vercel CLI and one `gh api`
call. More importantly, the product needs **job-level** control that a composite
Action cannot have:

- the `if:` gate that skips the job, so an ignored event costs no runner;
- a per-PR `concurrency` group on the job;
- a job `timeout-minutes`;
- secrets received through `secrets: inherit`.

A composite Action runs as steps inside a job the consumer owns, so every one of
those would move back into each consumer's YAML. Centralizing them is the reason
this repo exists. The `-ci` suffix follows the fleet convention for reusable
workflows that wrap third-party tooling (`storybook-ci`, `semantic-release-ci`).

## Build in Actions with the Vercel CLI

The workflow runs `vercel build` on the Actions runner, then
`vercel deploy --prebuilt`. The alternative would be `vercel deploy` and letting
Vercel build remotely. Building in Actions:

- shows build failures in the PR's checks, next to the rest of CI;
- needs no Vercel-side switch: the Git integration stays off for previews, and
  the CLI deploy is not subject to it.

## The CLI version is pinned in package.json

The workflow installs an exact Vercel CLI version read from this repo's
`package.json` at the workflow's own pinned SHA (`job.workflow_sha`). A version
written as a string in the workflow's YAML would not be seen by Dependabot. A
`dependencies` entry is:

- bumped by Dependabot's `npm` ecosystem with the `fix` prefix, so each bump cuts
  a release; and
- delivered to every consumer by their next `github-actions` pin bump.

Only `package.json` is checked out (sparse checkout), and it is deleted before
`vercel build` so it is never part of the consumer's project tree. The
`vercel-version` input overrides the pin for a consumer that must hold a
version back.

## Git-integration previews are disabled declaratively

The per-repo Ignored Build Step scripts were a poor thing to share. They run
inside Vercel's build, not in Actions, so a shared copy would need registry auth
wired into each Vercel build environment. Under the label-driven model they also
have only one decision left, "production only", and `git.deploymentEnabled`
states that in `vercel.json` with no code. See
[Disabling Git-integration previews](disabling-git-previews.md).

## The UAT labels are fixed, not inputs

See [The deploy gate](gating.md#the-label-rename).
