import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * Guards this repo's own pr-policy caller. pr-policy's `title` check blocks a
 * WIP-marked title only on a PR that isn't a draft, so the verdict goes stale
 * whenever a PR flips between draft and ready unless those events re-run it.
 * Nothing else fails when the trigger list drops them: the stale green verdict
 * just stands, and a WIP-titled PR can merge.
 */

type Workflow = {
  on?: { pull_request_target?: { types?: string[] } };
};

const workflow = parse(
  readFileSync(new URL('../.github/workflows/pr-policy.yml', import.meta.url), 'utf8'),
) as Workflow;
const types = workflow.on?.pull_request_target?.types ?? [];

describe('pr-policy.yml triggers', () => {
  it('re-runs when a PR is marked ready for review or converted to a draft', () => {
    expect(types).toEqual(expect.arrayContaining(['ready_for_review', 'converted_to_draft']));
  });

  it('re-runs on title edits and label changes, which the title and label checks read', () => {
    expect(types).toEqual(
      expect.arrayContaining([
        'opened',
        'synchronize',
        'reopened',
        'edited',
        'labeled',
        'unlabeled',
      ]),
    );
  });
});
