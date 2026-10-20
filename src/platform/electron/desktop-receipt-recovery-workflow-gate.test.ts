import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { load } = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
type Step = {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, string>>;
};
type Workflow = {
  readonly on: Readonly<Record<string, unknown>>;
  readonly permissions: Readonly<Record<string, string>>;
  readonly concurrency: { readonly group: string; readonly 'cancel-in-progress': boolean };
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly if: string;
        readonly environment: string;
        readonly 'runs-on': string;
        readonly steps: readonly Step[];
      }
    >
  >;
};
const read = (file: string): string => readFileSync(file, 'utf8');
const text = read('.github/workflows/recover-desktop-release-receipt.yml');
const workflow = load(text) as Workflow;
const job = workflow.jobs.recover!;

describe('manual original desktop receipt recovery', () => {
  it('holds every entry behind manual canonical main, the existing switch, environment and shared lock', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(Object.keys(workflow.jobs)).toEqual(['recover']);
    for (const guard of [
      "github.event_name == 'workflow_dispatch'",
      "github.ref == 'refs/heads/main'",
      "github.repository == 'cisgz3a-hub/KerfDesk'",
      "vars.KERFDESK_UNSIGNED_RELEASES == 'on'",
    ])
      expect(job.if).toContain(guard);
    expect(job.environment).toBe('desktop-commercial');
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(workflow.concurrency).toEqual({
      group: 'kerfdesk-commercial-manual-publication',
      'cancel-in-progress': false,
    });
    const ordinary = load(read('.github/workflows/release-desktop-unsigned.yml')) as Workflow;
    expect(workflow.concurrency).toEqual(ordinary.concurrency);
  });
  it('runs only current main code, treating all original inputs as quoted data', () => {
    const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]?.with).toMatchObject({
      ref: '${{ github.sha }}',
      'fetch-depth': 0,
      'persist-credentials': false,
    });
    const retry = job.steps.find((step) =>
      step.name?.startsWith('Authenticate original evidence'),
    )!;
    expect(retry.run).toBe(
      'node scripts/recover-desktop-release-receipt.mjs "$ORIGINAL_RUN_ID" "$ORIGINAL_ATTEMPT" "$ORIGINAL_SOURCE_SHA" "$ORIGINAL_VERSION"',
    );
    expect(retry.run).not.toContain('${{');
    expect(retry.env?.ORIGINAL_SOURCE_SHA).toBe('${{ inputs.source_sha }}');
    expect(text).not.toContain('git fetch');
    expect(text).not.toMatch(
      /pnpm install|electron-builder|publish-manual-commercial-release|release-now|release_now|KERFDESK_RELEASE_NOW/u,
    );
    const helper = read('scripts/recover-desktop-release-receipt.mjs');
    expect(helper).toContain("request.sourceSha + ':pnpm-lock.yaml'");
    expect(helper).toContain(
      "validateRecoveryMain(env.GITHUB_SHA, await reader.json('/git/ref/heads/main'))",
    );
    expect(helper.indexOf('validateRecoveryMain(env.GITHUB_SHA')).toBeLessThan(
      helper.indexOf('const store = await createStableReleaseStore'),
    );
    expect(helper).not.toMatch(
      /git.*checkout|GITHUB_RUN_ID\s*[:=]\s*request.runId|GITHUB_RUN_ATTEMPT\s*[:=]\s*request.runAttempt/u,
    );
    expect(helper.indexOf('validateOriginalAttempt(')).toBeLessThan(
      helper.indexOf('const store = await createStableReleaseStore'),
    );
    expect(helper.indexOf('selectRecoveryArtifacts(')).toBeLessThan(
      helper.indexOf('const store = await createStableReleaseStore'),
    );
  });
  it('keeps signing/storage configuration in the protected retry step and retains its distinct audit', () => {
    const secretSteps = job.steps.filter((step) =>
      Object.values(step.env ?? {}).some((value) => value.includes('secrets.')),
    );
    expect(secretSteps).toHaveLength(1);
    expect(secretSteps[0]?.run).toContain('recover-desktop-release-receipt.mjs');
    const upload = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.with).toMatchObject({
      'retention-days': 90,
      path: '${{ runner.temp }}/desktop-receipt-recovery/',
    });
    expect(read('scripts/desktop-receipt-recovery.mjs')).toContain(
      "receipt.conclusion === 'failure'",
    );
    expect(read('scripts/recover-desktop-release-receipt.mjs')).toContain(
      'historicalDeliveryOnly: true',
    );
  });
});
