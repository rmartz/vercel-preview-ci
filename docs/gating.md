---
type: Reference
title: The deploy gate
description: Exactly which pull_request events deploy a preview — the functional title types, the `preview` and `no preview` labels, the do-not-merge / fork / Dependabot exclusions, why ready_for_review and unrelated labels do not redeploy, and the per-PR concurrency.
tags: [vercel, preview, labels, gating, conventional-commits]
---

# The deploy gate

The workflow's only job has an `if:` gate. A skipped job costs nothing: no
runner and no deploy. A preview is for testing a functional change, so the gate
deploys PRs that change behavior and skips the rest (docs, CI, tests, chores,
dependency bumps), whether or not the PR is a draft.

## Which PRs deploy

Every condition below must hold:

| Condition                                     | Why                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Event is `pull_request`                       | The gate reads PR fields. Other events never deploy.                               |
| Head repo is this repo                        | Fork PRs get no secrets, and the Vercel token must never reach fork-authored code. |
| PR does not carry `do not merge`              | A held PR is not ready for testing.                                                |
| PR does not carry `no preview`                | The opt-out. It wins over everything else, `preview` included.                     |
| PR is functional **or** carries `preview`     | See below.                                                                         |
| The event could change what the preview shows | See [Which events deploy](#which-events-deploy).                                   |

**Functional** means the PR title starts with a functional Conventional Commit
type, `feat`, `fix`, `perf` or `revert`, with an optional `(scope)` and `!`:
`feat: …`, `fix(api): …`, `perf!: …`, `revert(ui)!: …`. These are the types
that release, so they are the changes worth testing. `chore`, `docs`, `ci`,
`test`, `build`, `refactor` and `style` PRs get no preview. The match is a
prefix check (`feat(` accepts `feat(ui) no colon`), and like every Actions
string comparison it ignores case. GitHub's own `Revert "…"` title is not
`revert:`, so it needs a retitle or `preview`.

**Dependabot PRs never deploy on their title.** The gate skips any PR opened by
`dependabot[bot]` unless it carries `preview`, so a bump titled `fix(deps): …`
does not build either.

**`preview` forces a deploy** of any same-repo PR that is not held, whatever its
title or author. Use it when a `refactor:` or `chore:` PR still needs a look.

**Drafts deploy.** Testing happens before a PR is marked ready, so a draft with
a functional title gets a preview on each push.

## Which events deploy

The caller subscribes to six `pull_request` activity types. The gate accepts
each one only in the cases where a new preview is useful:

| Activity      | Deploys when                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `opened`      | Always, if the PR qualifies.                                                                                                |
| `synchronize` | Always, if the PR qualifies. A new head commit was pushed.                                                                  |
| `reopened`    | Always, if the PR qualifies.                                                                                                |
| `labeled`     | The label just added is `preview`, and the PR is not held by `do not merge` or `no preview`.                                |
| `unlabeled`   | The label just removed is `do not merge` or `no preview`, and the PR qualifies.                                             |
| `edited`      | The title changed from a non-functional one to a functional one, the PR qualifies, and it does not already carry `preview`. |

Everything else is skipped:

- **`ready_for_review`.** Taking a PR out of draft, often just to merge it, must
  not rebuild a commit that was already deployed as a draft. A caller still
  subscribed to it from an older version does no harm; the gate skips it.
- **An unrelated label.** Otherwise every triage label rebuilds the same commit.
- **A body edit, or rewording a title that was already functional.** The
  commit is unchanged and was already deployed.

**Labels added after the PR opens race the `opened` deploy.** The `opened`
event carries the labels the PR had at creation. `gh pr create --label` adds
labels in a separate call after the PR exists, so a `no preview` or
`do not merge` added that way may arrive too late to stop the first deploy,
and the later `labeled` event cannot cancel it. To keep a functional PR from
ever deploying, open it with a non-functional title, add `no preview`, then
retitle it; or add `no preview` right after opening and accept one deploy.
Likewise, a PR opened with `preview` already applied may build twice (`opened`
and `labeled`); concurrency cancels one of them.

Removing `preview`, adding `no preview`, or retitling a PR to a non-functional
type does **not** delete an existing preview. The PR simply stops being
redeployed, and the sticky comment keeps pointing at the last preview. If the
consumer sets a per-PR `alias-domain`, the PR's host also keeps pointing at that
preview (see
[A per-PR preview hostname](consuming.md#a-per-pr-preview-hostname)).

## The labels

Create `preview` and `no preview` in each consuming repo. `do not merge` is
already part of the fleet's label roster.

The label names are fixed in the workflow, not inputs. They are a fleet
contract, and a per-repo override would let one repo drift from it.
[`test/vercel-preview-gate.test.ts`](../test/vercel-preview-gate.test.ts) runs
the gate against sample events with GitHub's own expression evaluator, so any
change to these rules is deliberate.

## History: the UAT labels

Before v3.0.0, a preview deployed only when a non-draft PR carried `UAT ready`
(or the legacy `ready for UAT`), and `ready_for_review` deployed. That gate
depended on a review step applying the label, which the fleet no longer does.
The UAT labels now have no effect on previews. To upgrade a caller, see
[Upgrading from v2](consuming.md#upgrading-from-v2).

## Concurrency

Concurrency is set per PR on the **job**:
`vercel-preview-<repo>-<pr>` with `cancel-in-progress: true`. A newer push
cancels the in-flight deploy of an older commit. Because the group is on the job,
an event the gate skips never joins the group, so it cannot cancel a deploy that
is still needed. For the same reason, callers should **not** add a
workflow-level `concurrency:` block.
