import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * Keeps docs/golden-pattern.md, the supported way to consume this repo, in sync
 * with the two reusable workflows. Each caller in the page is parsed and checked
 * against the workflow it calls: every `with:` key is a declared input, every
 * required input is passed, the caller grants the permissions the workflow
 * declares, and the alias hosts pass the workflow's own hostname check.
 */

type Input = { type?: string; required?: boolean; default?: unknown };
type CalledWorkflow = {
  on?: { workflow_call?: { inputs?: Record<string, Input> } };
  permissions?: Record<string, string>;
  jobs?: Record<string, { steps?: { name?: string; run?: string }[] }>;
};
type CallerJob = { uses?: string; with?: Record<string, unknown>; secrets?: unknown };
type Caller = {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, CallerJob>;
};

const readText = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const page = readText('docs/golden-pattern.md');
const fenced = (lang: string) =>
  [...page.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```', 'g'))].map(
    (match) => match[1] ?? '',
  );

const callers = fenced('yaml').map((text) => parse(text) as Caller);
const USES = /^rmartz\/vercel-preview-ci\/\.github\/workflows\/(vercel-[a-z]+\.yml)@<sha>$/;

// Each documented caller job, paired with the workflow file it calls.
const callerJobs = callers.flatMap((caller) =>
  Object.values(caller.jobs ?? {}).map((job) => ({
    caller,
    job,
    file: USES.exec(job.uses ?? '')?.[1] ?? '',
  })),
);
const byFile = (file: string) => callerJobs.find((entry) => entry.file === file);
const called = (file: string) => parse(readText(`.github/workflows/${file}`)) as CalledWorkflow;

describe('docs/golden-pattern.md callers', () => {
  it('documents one caller for each reusable workflow', () => {
    expect(callerJobs.map((entry) => entry.file).sort()).toEqual([
      'vercel-preview.yml',
      'vercel-staging.yml',
    ]);
  });

  describe.each(['vercel-preview.yml', 'vercel-staging.yml'])('the %s caller', (file) => {
    const entry = byFile(file);
    const workflow = called(file);
    const inputs = workflow.on?.workflow_call?.inputs ?? {};
    const passed = entry?.job.with ?? {};

    it('passes only inputs the workflow declares', () => {
      for (const key of Object.keys(passed)) {
        expect(Object.keys(inputs)).toContain(key);
      }
    });

    it('passes every required input', () => {
      for (const [key, input] of Object.entries(inputs)) {
        if (input.required) expect(Object.keys(passed)).toContain(key);
      }
    });

    // A called workflow can only narrow the caller's grant.
    it('grants exactly the permissions the workflow declares', () => {
      expect(entry?.caller.permissions).toEqual(workflow.permissions);
    });

    it('inherits the Vercel secrets', () => {
      expect(entry?.job.secrets).toBe('inherit');
    });

    it("passes an alias host the workflow's hostname check accepts", () => {
      const check = workflow.jobs?.deploy?.steps?.find(
        (step) => step.name === 'Check the alias domain',
      );
      const pattern = /grep -qE '([^']+)'/.exec(check?.run ?? '')?.[1] ?? '';
      expect(pattern).not.toBe('');
      // Stand in a PR number for the per-PR expression.
      const host = String(passed['alias-domain'] ?? '').replace(/\$\{\{[^}]*\}\}/g, '123');
      expect(new RegExp(pattern).test(host)).toBe(true);
    });
  });

  // docs/gating.md: the preview gate decides which of these deploy.
  it('subscribes the preview caller to every activity type the gate reads', () => {
    expect(byFile('vercel-preview.yml')?.caller.on).toEqual({
      pull_request: {
        types: ['labeled', 'unlabeled', 'synchronize', 'reopened', 'ready_for_review'],
      },
    });
  });

  it('builds the per-PR preview host from the PR number', () => {
    expect(byFile('vercel-preview.yml')?.job.with?.['alias-domain']).toContain(
      '${{ github.event.pull_request.number }}',
    );
  });

  it('triggers the staging caller on a push to the default branch', () => {
    expect(byFile('vercel-staging.yml')?.caller.on).toEqual(
      expect.objectContaining({ push: { branches: ['main'] } }),
    );
  });

  it('keeps production on the default branch only in vercel.json', () => {
    const configs = fenced('json').map(
      (text) => JSON.parse(text) as { git?: { deploymentEnabled?: Record<string, boolean> } },
    );
    expect(configs.map((config) => config.git?.deploymentEnabled)).toContainEqual({
      main: true,
      '**': false,
    });
  });
});
