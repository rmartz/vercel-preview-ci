import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * Guards the consumer-facing contracts of the reusable workflow. None of these
 * fail in this repo's own CI when they regress — the workflow never runs here —
 * so each would otherwise surface only as a broken or wasted deploy somewhere in
 * the fleet. actionlint (the Lint job) covers syntax and expression typing; these
 * cover intent.
 */

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};
type Job = {
  if?: string;
  'timeout-minutes'?: string | number;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  steps?: Step[];
};
type WorkflowCall = {
  inputs?: Record<string, { type?: string; required?: boolean; default?: unknown }>;
  outputs?: Record<string, { value?: string }>;
  secrets?: Record<string, { required?: boolean }>;
};
type Workflow = {
  on?: { workflow_call?: WorkflowCall };
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
};

const readText = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const workflow = parse(readText('.github/workflows/vercel-preview.yml')) as Workflow;
const job = workflow.jobs?.deploy ?? {};
const steps = job.steps ?? [];
const gate = job.if ?? '';
const stepNamed = (name: string) => steps.find((step) => step.name === name);
const stepIndex = (name: string) => steps.findIndex((step) => step.name === name);
const call = workflow.on?.workflow_call ?? {};

describe('vercel-preview.yml triggers and permissions', () => {
  it('is a reusable workflow only: the caller owns the triggers', () => {
    expect(Object.keys(workflow.on ?? {})).toEqual(['workflow_call']);
  });

  it('declares exactly the scopes it needs', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      packages: 'read',
      'pull-requests': 'write',
    });
  });

  it('bounds the job with a timeout', () => {
    expect(job['timeout-minutes']).toBeDefined();
  });

  it('serializes per PR at the job level, cancelling superseded deploys', () => {
    expect(job.concurrency?.group).toContain('github.event.pull_request.number');
    expect(job.concurrency?.['cancel-in-progress']).toBe(true);
  });
});

// The public API (AGENTS.md "The public surface"). Renaming, removing, or
// changing the default of any of these breaks consumers, so a change here must
// be deliberate: update this test and ship it as the right release type.
describe('vercel-preview.yml public interface', () => {
  it('keeps the input names, types and defaults', () => {
    expect(call.inputs).toEqual({
      'node-version': expect.objectContaining({ type: 'string', required: false, default: '24.x' }),
      'vercel-version': expect.objectContaining({ type: 'string', required: false, default: '' }),
      'timeout-minutes': expect.objectContaining({ type: 'number', required: false, default: 10 }),
    });
  });

  it('exposes the deploy URL as the `url` output', () => {
    expect(Object.keys(call.outputs ?? {})).toEqual(['url']);
    expect(call.outputs?.url?.value).toBe('${{ jobs.deploy.outputs.url }}');
  });

  it('accepts exactly the three Vercel secrets', () => {
    expect(Object.keys(call.secrets ?? {}).sort()).toEqual([
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
      'VERCEL_TOKEN',
    ]);
  });
});

describe('vercel-preview.yml gate', () => {
  it('skips fork PRs so the Vercel token never reaches fork-authored code', () => {
    expect(gate).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('skips drafts and PRs held by `do not merge`', () => {
    expect(gate).toContain('!github.event.pull_request.draft');
    expect(gate).toContain("!contains(github.event.pull_request.labels.*.name, 'do not merge')");
  });

  // Both spellings while the fleet-wide rename (rmartz/dotfiles#1572) is in
  // progress. Dropping `ready for UAT` is a breaking change for any consumer
  // still on the old label — ship it as a major.
  it.each(['UAT ready', 'ready for UAT'])('deploys on the %s label', (label) => {
    expect(gate).toContain(`contains(github.event.pull_request.labels.*.name, '${label}')`);
    expect(gate).toContain(`github.event.label.name == '${label}'`);
  });

  it('redeploys when `do not merge` is removed', () => {
    expect(gate).toContain(
      "github.event.action == 'unlabeled' && github.event.label.name == 'do not merge'",
    );
  });
});

describe('vercel-preview.yml deploy steps', () => {
  it('passes the job token to the build for a consumer private registry', () => {
    expect(stepNamed('Build')?.env?.NODE_AUTH_TOKEN).toBe('${{ github.token }}');
  });

  it('builds and deploys the preview environment as prebuilt output', () => {
    expect(stepNamed('Pull the Vercel preview environment')?.run).toContain(
      '--environment=preview',
    );
    expect(stepNamed('Deploy prebuilt preview')?.run).toContain('vercel deploy --prebuilt');
  });

  // Migrating repos used this marker; keeping it lets the first shared deploy
  // edit their existing comment instead of posting a second one.
  it('keeps the sticky-comment marker the per-repo workflows used', () => {
    expect(stepNamed('Post or update the sticky PR comment')?.run).toContain(
      "marker='<!-- vercel-preview-bot -->'",
    );
  });

  // Dependabot-triggered runs get a read-only token; the comment write would
  // fail after a successful deploy.
  it('skips the comment on Dependabot-triggered runs', () => {
    expect(stepNamed('Post or update the sticky PR comment')?.if).toBe(
      "github.actor != 'dependabot[bot]'",
    );
  });

  it('reads the CLI version from this repo at its own pinned SHA', () => {
    const checkout = stepNamed('Check out vercel-preview-ci (its own pinned SHA)');
    expect(checkout?.with?.repository).toBe('${{ job.workflow_repository }}');
    expect(checkout?.with?.ref).toBe('${{ job.workflow_sha }}');
    expect(checkout?.with?.['sparse-checkout']).toBe('package.json');

    const resolve = stepNamed('Resolve the Vercel CLI version')?.run ?? '';
    expect(resolve).toContain("require('./_vercel-preview-ci/package.json').dependencies.vercel");
  });

  it('deletes its own checkout before `vercel build` sees the project tree', () => {
    const resolve = stepNamed('Resolve the Vercel CLI version')?.run ?? '';
    expect(resolve).toContain('rm -rf _vercel-preview-ci');

    const order = [
      'Check out the PR head',
      'Check out vercel-preview-ci (its own pinned SHA)',
      'Resolve the Vercel CLI version',
      'Install the Vercel CLI',
      'Build',
    ].map(stepIndex);
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('package.json Vercel CLI pin', () => {
  const pkg = JSON.parse(readText('package.json')) as { dependencies?: Record<string, string> };

  // The workflow installs exactly this string, and it is a production
  // dependency so Dependabot's bump of it is a releasing `fix`.
  it('pins vercel to an exact version in dependencies', () => {
    expect(pkg.dependencies?.vercel).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
