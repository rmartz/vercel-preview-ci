import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * Guards the consumer-facing contracts of the reusable staging workflow. Like
 * vercel-preview.yml it never runs in this repo's own CI, so a regression would
 * surface only as a broken or misdirected deploy in a consumer.
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
  outputs?: Record<string, string>;
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

const workflow = parse(readText('.github/workflows/vercel-staging.yml')) as Workflow;
const job = workflow.jobs?.deploy ?? {};
const steps = job.steps ?? [];
const gate = job.if ?? '';
const stepNamed = (name: string) => steps.find((step) => step.name === name);
const stepIndex = (name: string) => steps.findIndex((step) => step.name === name);
const call = workflow.on?.workflow_call ?? {};

describe('vercel-staging.yml triggers and permissions', () => {
  it('is a reusable workflow only: the caller owns the triggers', () => {
    expect(Object.keys(workflow.on ?? {})).toEqual(['workflow_call']);
  });

  // No PR, so no comment and no pull-requests scope.
  it('declares exactly the scopes it needs', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', packages: 'read' });
  });

  it('bounds the job with a timeout', () => {
    expect(job['timeout-minutes']).toBe('${{ inputs.timeout-minutes }}');
  });

  // One staging per repo: the newest default-branch commit wins. Job-level so a
  // skipped event never joins the group.
  it('serializes per repository at the job level, cancelling superseded deploys', () => {
    expect(job.concurrency?.group).toBe('vercel-staging-${{ github.repository }}');
    expect(job.concurrency?.['cancel-in-progress']).toBe(true);
  });
});

describe('vercel-staging.yml public interface', () => {
  it('keeps the input names, types and defaults', () => {
    expect(call.inputs).toEqual({
      'alias-domain': expect.objectContaining({ type: 'string', required: true }),
      'env-branch': expect.objectContaining({ type: 'string', required: false, default: '' }),
      'node-version': expect.objectContaining({ type: 'string', required: false, default: '24.x' }),
      'vercel-version': expect.objectContaining({ type: 'string', required: false, default: '' }),
      'timeout-minutes': expect.objectContaining({ type: 'number', required: false, default: 10 }),
    });
  });

  it('exposes the deploy URL as `url` and the alias as `alias-url`', () => {
    expect(Object.keys(call.outputs ?? {})).toEqual(['url', 'alias-url']);
    expect(call.outputs?.url?.value).toBe('${{ jobs.deploy.outputs.url }}');
    expect(call.outputs?.['alias-url']?.value).toBe('${{ jobs.deploy.outputs.alias-url }}');
    expect(job.outputs?.url).toBe('${{ steps.deploy.outputs.url }}');
    expect(job.outputs?.['alias-url']).toBe('${{ steps.alias.outputs.url }}');
  });

  it('accepts exactly the three Vercel secrets', () => {
    expect(Object.keys(call.secrets ?? {}).sort()).toEqual([
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
      'VERCEL_TOKEN',
    ]);
  });
});

describe('vercel-staging.yml gate', () => {
  it('runs only for a push or a manual dispatch', () => {
    expect(gate).toContain(
      "(github.event_name == 'push' || github.event_name == 'workflow_dispatch')",
    );
    expect(gate).not.toContain('pull_request');
  });

  it('runs only on the default branch', () => {
    expect(gate).toContain(
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    );
  });

  it('never runs in a fork', () => {
    expect(gate).toContain('!github.event.repository.fork');
  });
});

describe('vercel-staging.yml deploy steps', () => {
  it('builds the default branch commit that triggered the run', () => {
    expect(stepNamed('Check out the default branch')?.with?.ref).toBe('${{ github.sha }}');
  });

  // Only the variable selection follows env-branch; the code stays the default
  // branch's (the checkout above).
  it('pulls the Preview environment for the resolved env branch', () => {
    const pull = stepNamed('Pull the Vercel preview environment');
    expect(pull?.env?.ENV_BRANCH).toBe('${{ steps.env-branch.outputs.branch }}');
    expect(pull?.run).toContain('--environment=preview');
    expect(pull?.run).toContain('--git-branch="$ENV_BRANCH"');
  });

  describe('the env branch', () => {
    const resolve = stepNamed('Resolve the environment branch');

    it('reads the input and default branch through env, before the build', () => {
      expect(resolve?.env?.ENV_BRANCH).toBe('${{ inputs.env-branch }}');
      expect(resolve?.env?.DEFAULT_BRANCH).toBe('${{ github.event.repository.default_branch }}');
      expect(resolve?.run).toContain('GITHUB_STEP_SUMMARY');
      expect(stepIndex('Resolve the environment branch')).toBeLessThan(stepIndex('Build'));
    });

    // Run the step's own script, as the runner would, before any checkout.
    const run = (envBranch: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'env-branch-'));
      const output = join(dir, 'output');
      const summary = join(dir, 'summary');
      writeFileSync(output, '');
      writeFileSync(summary, '');
      const result = spawnSync('bash', ['-c', resolve?.run ?? ''], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          ENV_BRANCH: envBranch,
          DEFAULT_BRANCH: 'main',
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
        },
      });
      return {
        status: result.status,
        output: readFileSync(output, 'utf8'),
        summary: readFileSync(summary, 'utf8'),
      };
    };

    it('falls back to the default branch when unset, so existing callers are unchanged', () => {
      const result = run('');
      expect(result.status).toBe(0);
      expect(result.output).toBe('branch=main\n');
      expect(result.summary).toContain('main');
    });

    it.each(['staging', 'env/staging'])('accepts %s and writes it to the summary', (branch) => {
      const result = run(branch);
      expect(result.status).toBe(0);
      expect(result.output).toBe(`branch=${branch}\n`);
      expect(result.summary).toContain(branch);
    });

    it.each(['two words', '-staging', 'a..b', 'staging.lock', 'refs/heads/x~1'])(
      'rejects %j before the build',
      (branch) => {
        const result = run(branch);
        expect(result.status).not.toBe(0);
        expect(result.output).toBe('');
      },
    );
  });

  it('passes the job token to the build for a consumer private registry', () => {
    expect(stepNamed('Build')?.env?.NODE_AUTH_TOKEN).toBe('${{ github.token }}');
  });

  // A --prod deploy would take the production domains.
  it('deploys prebuilt output as a preview deployment, never --prod', () => {
    const deploy = stepNamed('Deploy prebuilt staging')?.run ?? '';
    expect(deploy).toContain('vercel deploy --prebuilt');
    expect(steps.some((step) => (step.run ?? '').includes('--prod'))).toBe(false);
  });

  it('aliases the deployed URL to the staging domain, after the deploy', () => {
    const alias = stepNamed('Alias the deployment to the staging domain');
    expect(alias?.if).toBeUndefined();
    expect(alias?.env?.URL).toBe('${{ steps.deploy.outputs.url }}');
    expect(alias?.env?.ALIAS_DOMAIN).toBe('${{ inputs.alias-domain }}');
    expect(alias?.run).toContain('vercel alias set "$URL" "$ALIAS_DOMAIN"');
    expect(stepIndex('Alias the deployment to the staging domain')).toBeGreaterThan(
      stepIndex('Deploy prebuilt staging'),
    );
  });

  it('writes both URLs to the job summary', () => {
    expect(stepNamed('Deploy prebuilt staging')?.run).toContain('GITHUB_STEP_SUMMARY');
    expect(stepNamed('Alias the deployment to the staging domain')?.run).toContain(
      'GITHUB_STEP_SUMMARY',
    );
  });

  it('passes the token only through --token, never interpolated', () => {
    for (const step of steps) {
      expect(step.run ?? '').not.toContain('secrets.');
      expect(step.run ?? '').not.toContain('${{');
    }
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
      'Check out the default branch',
      'Check out vercel-preview-ci (its own pinned SHA)',
      'Resolve the Vercel CLI version',
      'Install the Vercel CLI',
      'Build',
    ].map(stepIndex);
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  // Same check, same pattern as vercel-preview.yml: fail before the build.
  it('validates the alias domain before the build, with the preview workflow regex', () => {
    const check = stepNamed('Check the alias domain');
    const preview = readText('.github/workflows/vercel-preview.yml');
    const pattern = /grep -qE '([^']+)' <<< "\$ALIAS_DOMAIN"/.exec(check?.run ?? '')?.[1] ?? '';
    expect(pattern).not.toBe('');
    expect(preview).toContain(pattern);
    expect(check?.env?.ALIAS_DOMAIN).toBe('${{ inputs.alias-domain }}');
    expect(stepIndex('Check the alias domain')).toBeLessThan(stepIndex('Build'));
  });
});
