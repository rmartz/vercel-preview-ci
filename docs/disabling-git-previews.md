---
type: Reference
title: Disabling Git-integration previews
description: How a consuming repo turns off Vercel's automatic Git-integration preview builds with one vercel.json key while keeping production deploys of main, replacing the per-repo Ignored Build Step scripts.
tags: [vercel, vercel-json, git-integration, ignored-build-step]
---

# Disabling Git-integration previews

The label-driven model needs Vercel's Git integration to deploy **production
only**. Without that, every push still builds a preview, and labelled PRs get a
second one from this workflow. The Git integration has to stop building
previews, and `main` has to keep deploying to production.

## The setting

Add `git.deploymentEnabled` to the repo's `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "main": true,
      "**": false
    }
  }
}
```

Two documented rules of
[`git.deploymentEnabled`](https://vercel.com/docs/project-configuration/git-configuration)
make this work:

- The keys are branch globs (minimatch). `**` matches every branch, including
  names with a `/` such as `feat/foo`. A single `*` does **not** match across `/`.
- When a branch matches more than one key, the branch deploys if **any**
  matching key is `true`. `main` matches both keys and deploys. Every other
  branch matches only `**` and does not.

If the production branch is not `main`, use its name in place of `main`.

Remove the `ignoreCommand` key and delete the `scripts/vercel-ignore-build.*`
script it pointed to. The guard has nothing left to decide.

## Why this does not block the workflow's deploys

`git.deploymentEnabled` controls only deployments that the **Git integration**
creates in response to a push. The workflow deploys with the Vercel CLI
(`vercel deploy --prebuilt`). That is a separate path, and the setting does not
apply to it. The Ignored Build Step does not run for prebuilt CLI deploys
either.

## Verifying it

After the change merges:

1. Push a commit to a non-`main` branch with an open PR and no UAT label. The
   Vercel dashboard should show **no** new deployment for that branch.
2. Add `UAT ready` to the PR. A preview should appear from the workflow, and its
   URL should be posted on the PR.
3. Merge to `main`. A production deployment should appear from the Git
   integration as before.

## If the declarative setting cannot be used

If a project cannot use `git.deploymentEnabled`, a one-line Ignored Build Step
does the same job without a script. Vercel skips the build when the command
exits `0`:

```json
{
  "ignoreCommand": "[ \"$VERCEL_ENV\" != \"production\" ]"
}
```

Prefer `git.deploymentEnabled`. With it, Vercel creates no deployment at all.
An Ignored Build Step creates a deployment for every push and then cancels it,
so the dashboard fills with canceled entries.
