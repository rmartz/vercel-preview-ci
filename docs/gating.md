---
type: Reference
title: The deploy gate
description: Exactly which pull_request events deploy a preview — the UAT labels, the draft / do-not-merge / fork exclusions, why unrelated labels do not redeploy, and the per-PR concurrency.
tags: [vercel, preview, uat, labels, gating]
---

# The deploy gate

The workflow's only job has an `if:` gate. A skipped job costs nothing: no
runner and no deploy. Every condition below must hold for a deploy to run.

| Condition                                           | Why                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Event is `pull_request`                             | The gate reads PR fields. Other events never deploy.                                          |
| Head repo is this repo                              | Fork PRs get no secrets, and the Vercel token must never reach fork-authored code.            |
| PR is not a draft                                   | A draft is unfinished work.                                                                   |
| PR does not carry `do not merge`                    | A held PR is not ready for testing.                                                           |
| PR carries `UAT ready` **or** `ready for UAT`       | The label is the request for a preview.                                                       |
| The event could change what the preview should show | See below. Without this, any label added to a labelled PR would rebuild an identical preview. |

## Which events deploy

The caller subscribes to five `pull_request` activity types. The gate accepts
each one only in the cases where a new preview is useful:

| Activity           | Deploys when                                                 |
| ------------------ | ------------------------------------------------------------ |
| `labeled`          | The label just added is `UAT ready` or `ready for UAT`.      |
| `unlabeled`        | The label just removed is `do not merge`.                    |
| `synchronize`      | Always, if the PR is labelled. A new head commit was pushed. |
| `reopened`         | Always, if the PR is labelled.                               |
| `ready_for_review` | Always, if the PR is labelled. A labelled draft left draft.  |

Removing the UAT label does **not** delete an existing preview. The PR simply
stops being redeployed, and the sticky comment keeps pointing at the last
preview.

## The label rename

The fleet is renaming `ready for UAT` to `UAT ready`
([rmartz/dotfiles#1572](https://github.com/rmartz/dotfiles/issues/1572)). Both
names are accepted while the rename rolls out. When every consumer has moved,
dropping `ready for UAT` is a **breaking change** for any repo that still uses
it, so release it as a major (`feat!:`). The test in
[`test/vercel-preview-workflow.test.ts`](../test/vercel-preview-workflow.test.ts)
pins both names so the change is deliberate.

The label names are fixed in the workflow, not inputs. They are a fleet contract
shared with `/review` and `pr-policy`'s UAT check, and a per-repo override would
let one repo drift from that contract.

## Concurrency

Concurrency is set per PR on the **job**:
`vercel-preview-<repo>-<pr>` with `cancel-in-progress: true`. A newer push
cancels the in-flight deploy of an older commit. Because the group is on the job,
an event the gate skips never joins the group, so it cannot cancel a deploy that
is still needed. For the same reason, callers should **not** add a
workflow-level `concurrency:` block.
