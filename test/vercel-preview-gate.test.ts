import { readFileSync } from 'node:fs';

import { Evaluator, Lexer, Parser, data } from '@actions/expressions';
import { truthy } from '@actions/expressions/result';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * Runs the reusable workflow's real `if:` gate (docs/gating.md) against sample
 * pull_request events, with GitHub's own expression evaluator, so the tests
 * exercise Actions semantics (case-insensitive comparison, null handling, the
 * `.*` filter) rather than matching substrings of the expression.
 */

type Workflow = { jobs?: Record<string, { if?: string }> };

const workflow = parse(
  readFileSync(new URL('../.github/workflows/vercel-preview.yml', import.meta.url), 'utf8'),
) as Workflow;
const gate = workflow.jobs?.deploy?.if ?? '';

const parsedGate = (() => {
  const { tokens } = new Lexer(gate).lex();
  return new Parser(tokens, ['github'], []).parse();
})();

const evaluateGate = (github: Record<string, unknown>): boolean => {
  const context = JSON.parse(JSON.stringify({ github }), data.reviver) as data.Dictionary;
  return truthy(new Evaluator(parsedGate, context).evaluate());
};

// The gate (docs/gating.md), run against sample pull_request events with a
// small Actions-expression evaluator. Each case starts from a same-repo,
// human-authored PR with a functional title on a new push, which deploys, and
// changes one thing.
type Scenario = {
  action?: string;
  title?: string;
  labels?: string[];
  label?: string;
  author?: string;
  draft?: boolean;
  fork?: boolean;
  eventName?: string;
  oldTitle?: string;
  bodyOnlyEdit?: boolean;
};

const deploys = (scenario: Scenario): boolean => {
  const {
    action = 'synchronize',
    title = 'feat: add a thing',
    labels = [],
    label,
    author = 'rmartz',
    draft = false,
    fork = false,
    eventName = 'pull_request',
    oldTitle,
    bodyOnlyEdit = false,
  } = scenario;
  const changes = bodyOnlyEdit
    ? { body: { from: 'old body' } }
    : oldTitle === undefined
      ? {}
      : { title: { from: oldTitle } };
  return evaluateGate({
    event_name: eventName,
    repository: 'rmartz/app',
    event: {
      action,
      ...(label === undefined ? {} : { label: { name: label } }),
      ...(action === 'edited' ? { changes } : {}),
      pull_request: {
        title,
        draft,
        number: 7,
        user: { login: author },
        labels: labels.map((name) => ({ name })),
        head: { repo: { full_name: fork ? 'someone/app' : 'rmartz/app' } },
      },
    },
  });
};

const FUNCTIONAL_TITLES = [
  'feat: x',
  'fix: x',
  'perf: x',
  'revert: x',
  'feat(ui): x',
  'fix(api)!: x',
  'feat!: x',
  'perf!: x',
  'revert(deps): x',
  'Feat: x',
  'FIX(api): x',
];

const NON_FUNCTIONAL_TITLES = [
  'chore: x',
  'docs: x',
  'ci: x',
  'test: x',
  'build(deps): x',
  'refactor: x',
  'style: x',
  'chore(deps): bump vercel',
  'feature: x',
  'fixup: x',
  'Revert "feat: x"',
  'WIP feat: x',
];

describe('vercel-preview.yml gate', () => {
  it('deploys a same-repo PR with a functional title on a new push', () => {
    expect(deploys({})).toBe(true);
  });

  it.each(FUNCTIONAL_TITLES)('treats %j as functional', (title) => {
    expect(deploys({ title })).toBe(true);
  });

  it.each(NON_FUNCTIONAL_TITLES)('treats %j as non-functional', (title) => {
    expect(deploys({ title })).toBe(false);
  });

  it('forces a deploy of a non-functional title with the `preview` label', () => {
    expect(deploys({ title: 'chore: x', labels: ['preview'] })).toBe(true);
  });

  it('deploys drafts', () => {
    expect(deploys({ draft: true })).toBe(true);
  });

  // The Vercel token must never reach fork-authored code.
  it('skips fork PRs, even with `preview`', () => {
    expect(gate).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(deploys({ fork: true })).toBe(false);
    expect(deploys({ fork: true, labels: ['preview'] })).toBe(false);
  });

  it('skips anything but pull_request events', () => {
    expect(deploys({ eventName: 'pull_request_target' })).toBe(false);
  });

  it.each(['do not merge', 'no preview'])('skips a PR labelled %j, even with `preview`', (held) => {
    expect(deploys({ labels: [held] })).toBe(false);
    expect(deploys({ labels: [held, 'preview'] })).toBe(false);
  });

  describe('Dependabot', () => {
    it('skips its PRs, even with a functional title', () => {
      expect(deploys({ author: 'dependabot[bot]', title: 'chore(deps): bump x' })).toBe(false);
      expect(deploys({ author: 'dependabot[bot]', title: 'fix(deps): bump vercel' })).toBe(false);
    });

    it('deploys its PR when it carries `preview`', () => {
      expect(deploys({ author: 'dependabot[bot]', labels: ['preview'] })).toBe(true);
    });
  });

  describe('which events deploy', () => {
    it.each(['opened', 'synchronize', 'reopened'])('deploys on %s', (action) => {
      expect(deploys({ action })).toBe(true);
    });

    // Taking a PR out of draft to merge it must not rebuild it.
    it.each(['ready_for_review', 'converted_to_draft', 'closed', 'assigned'])(
      'does not deploy on %s',
      (action) => {
        expect(deploys({ action })).toBe(false);
      },
    );

    it.each(['do not merge', 'no preview'])(
      'does not deploy when `preview` is added to a PR held by %j',
      (held) => {
        expect(deploys({ action: 'labeled', label: 'preview', labels: [held, 'preview'] })).toBe(
          false,
        );
      },
    );

    it('deploys when `preview` is added, even to a functional PR', () => {
      expect(deploys({ action: 'labeled', label: 'preview', labels: ['preview'] })).toBe(true);
      expect(
        deploys({ action: 'labeled', label: 'preview', labels: ['preview'], title: 'docs: x' }),
      ).toBe(true);
    });

    // Otherwise every triage label rebuilds the same commit.
    it('does not deploy when an unrelated label is added', () => {
      expect(deploys({ action: 'labeled', label: 'Docs', labels: ['Docs'] })).toBe(false);
      expect(deploys({ action: 'labeled', label: 'UAT ready', labels: ['UAT ready'] })).toBe(false);
    });

    it.each(['do not merge', 'no preview'])('deploys when %j is removed', (label) => {
      expect(deploys({ action: 'unlabeled', label })).toBe(true);
      expect(deploys({ action: 'unlabeled', label, title: 'chore: x' })).toBe(false);
    });

    it('does not deploy when `preview` or an unrelated label is removed', () => {
      expect(deploys({ action: 'unlabeled', label: 'preview' })).toBe(false);
      expect(deploys({ action: 'unlabeled', label: 'Docs' })).toBe(false);
    });

    describe('edited', () => {
      // Every non-functional old title must count as non-functional, so a stray
      // type in the old-title copy of the list cannot block a retitle deploy.
      it.each(NON_FUNCTIONAL_TITLES)(
        'deploys when %j is retitled to a functional type',
        (oldTitle) => {
          expect(deploys({ action: 'edited', oldTitle, title: 'feat: x' })).toBe(true);
        },
      );

      it('does not deploy on a body-only edit', () => {
        expect(deploys({ action: 'edited', bodyOnlyEdit: true })).toBe(false);
      });

      // Runs every functional title through the old-title copy of the type list,
      // so the two lists in the gate cannot drift apart unnoticed.
      it.each(FUNCTIONAL_TITLES)('does not redeploy when %j is reworded', (oldTitle) => {
        expect(deploys({ action: 'edited', oldTitle, title: 'fix: y' })).toBe(false);
      });

      it('does not deploy when Dependabot retitles its PR to a functional type', () => {
        expect(
          deploys({
            action: 'edited',
            author: 'dependabot[bot]',
            oldTitle: 'chore(deps): bump x',
            title: 'fix(deps): bump x',
          }),
        ).toBe(false);
      });

      it('does not deploy when the new title is not functional', () => {
        expect(deploys({ action: 'edited', oldTitle: 'feat: x', title: 'chore: x' })).toBe(false);
      });

      it('does not redeploy a PR `preview` already deployed', () => {
        expect(
          deploys({
            action: 'edited',
            oldTitle: 'chore: x',
            title: 'feat: x',
            labels: ['preview'],
          }),
        ).toBe(false);
      });
    });
  });

  // The UAT labels no longer gate anything (a breaking change, shipped as a major).
  it('no longer reads the UAT labels', () => {
    expect(gate).not.toContain('UAT');
  });
});
