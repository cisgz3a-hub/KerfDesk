import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// js-yaml ships no type declarations; this gate needs only its parser.
const { load } = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };

type Step = {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, string>>;
};
type Job = {
  readonly if?: string;
  readonly needs?: string | readonly string[];
  readonly 'runs-on'?: string;
  readonly environment?: string;
  readonly concurrency?: { readonly group: string; readonly 'cancel-in-progress': boolean };
  readonly permissions?: Readonly<Record<string, string>>;
  readonly outputs?: Readonly<Record<string, string>>;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly steps?: readonly Step[];
};
type Workflow = {
  readonly on: {
    readonly schedule: readonly { readonly cron: string }[];
    readonly workflow_dispatch: {
      readonly inputs: {
        readonly action: { readonly options: readonly string[]; readonly default: string };
      };
    };
  };
  readonly concurrency: { readonly group: string; readonly 'cancel-in-progress': boolean };
  readonly permissions: Readonly<Record<string, string>>;
  readonly jobs: Readonly<Record<string, Job>>;
};

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const needsOf = (job: Job): readonly string[] =>
  job.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : job.needs;
const stepText = (job: Job): string => JSON.stringify(job.steps ?? []);
const CUT_CRON = '17 7 * * 2';
const PROMOTE_CRON = '43 9 * * *';
const DUE = "needs.decide.outputs.due == 'true'";
const TRAIN_ON = "vars.KERFDESK_RELEASE_TRAIN == 'on'";

// The weekly commercial release train (ADR-541). Nothing may sign, publish or
// go live without the owner's word: the train is inert until the owner sets
// KERFDESK_RELEASE_TRAIN, and it never tags, pushes or uploads to GitHub.
describe('Release train workflow gate (ADR-541)', () => {
  const text = repoFile('.github/workflows/release-train.yml');
  const workflow = load(text) as Workflow;
  const { jobs } = workflow;
  const packageCheckText = repoFile('.github/workflows/desktop-package-check.yml');

  it('is inert by default: only the off job runs until the owner sets the variable', () => {
    expect(jobs.off?.if).toBe("vars.KERFDESK_RELEASE_TRAIN != 'on'");
    expect(jobs.off?.['runs-on']).toBe('ubuntu-latest');
    expect(jobs.off?.steps).toHaveLength(1);
    expect(stepText(jobs.off!)).not.toMatch(/secrets\.|uses/u);
    // Every other job needs the variable itself, or a job that does.
    const gated = (name: string): boolean => {
      const job = jobs[name]!;
      return job.if?.includes(TRAIN_ON) === true || needsOf(job).some(gated);
    };
    for (const name of Object.keys(jobs).filter((name) => name !== 'off'))
      expect(gated(name), name).toBe(true);
    for (const job of Object.values(jobs))
      expect(job.if ?? '').not.toMatch(/always\(\)|!cancelled/u);
    // Only an exact `on` switches it on; nothing treats an unset variable as on.
    expect(text.match(/vars\.KERFDESK_RELEASE_TRAIN [!=]= '[a-z]+'/gu)).toEqual(
      expect.arrayContaining([TRAIN_ON]),
    );
    expect(text).not.toMatch(/KERFDESK_RELEASE_TRAIN [!=]= '(?!on')/u);
  });

  it('cuts on Tuesdays and promotes daily, off the hour, and by hand', () => {
    expect(workflow.on.schedule.map((entry) => entry.cron)).toEqual([CUT_CRON, PROMOTE_CRON]);
    expect(workflow.on.workflow_dispatch.inputs.action.options).toEqual([
      'status',
      'cut',
      'promote',
    ]);
    expect(workflow.on.workflow_dispatch.inputs.action.default).toBe('status');
    expect(jobs.decide?.if).toContain(`github.event.schedule == '${CUT_CRON}'`);
    expect(jobs.decide?.if).toContain("inputs.action == 'cut'");
    expect(jobs.promote?.if).toContain(`github.event.schedule != '${CUT_CRON}'`);
    expect(jobs.promote?.if).toContain("inputs.action == 'promote'");
    for (const name of ['decide', 'promote'])
      expect(jobs[name]?.if).toContain("github.ref == 'refs/heads/main'");
  });

  it('decides on Linux and starts paid runners only when a release is due', () => {
    for (const name of ['off', 'decide', 'preflight', 'promote', 'status'])
      expect(jobs[name]?.['runs-on'], name).toBe('ubuntu-latest');
    expect(Object.values(jobs).filter((job) => job['runs-on'] === 'windows-latest')).toEqual([
      jobs.build,
    ]);
    expect(text).not.toContain('macos');
    expect(Object.keys(jobs.decide?.outputs ?? {})).toEqual([
      'due',
      'sha',
      'version',
      'published_at',
    ]);
    for (const name of ['preflight', 'native-check', 'build']) {
      expect(jobs[name]?.if, name).toBe(DUE);
      expect(needsOf(jobs[name]!), name).toContain('decide');
    }
    expect(needsOf(jobs.build!)).toEqual(['decide', 'preflight', 'native-check']);
    expect(needsOf(jobs['native-check']!)).toEqual(['decide', 'preflight']);
  });

  it('reuses the native desktop package check on the exact release commit', () => {
    const check = jobs['native-check']!;
    expect(check.uses).toBe('./.github/workflows/desktop-package-check.yml');
    expect(check.with).toEqual({ native: true, ref: '${{ needs.decide.outputs.sha }}' });
    expect(packageCheckText).toMatch(
      /workflow_call:\n {4}inputs:[\s\S]*\n {6}ref:\n {8}type: string/u,
    );
    expect(packageCheckText.match(/^ {10}ref: \$\{\{ inputs\.ref \}\}$/gmu)).toHaveLength(3);
    expect(packageCheckText).toContain(
      'group: desktop-package-check-${{ inputs.ref || github.ref }}',
    );
    expect(packageCheckText).toContain('$sourceCommit = (git rev-parse HEAD).Trim()');
    const build = jobs.build!;
    expect(build.steps?.[0]?.with?.ref).toBe('${{ needs.decide.outputs.sha }}');
    expect(jobs.preflight?.steps?.[0]?.with?.ref).toBe('${{ needs.decide.outputs.sha }}');
  });

  it('builds, checks and publishes the commercial package in that order', () => {
    const runs = (jobs.build?.steps ?? []).map((step) => step.run ?? '');
    const at = (fragment: string): number => runs.findIndex((run) => run.includes(fragment));
    const order = [
      'pnpm install --frozen-lockfile',
      'node scripts/prepare-commercial-desktop.mjs',
      'pnpm build:electron-main && pnpm build:bundle',
      'pnpm exec electron-builder --win --x64',
      'Get-AuthenticodeSignature',
      'node scripts/verify-packaged-desktop.mjs',
      'node scripts/verify-asar-integrity-enforced.mjs',
      'node scripts/publish-commercial-release.mjs',
    ].map(at);
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(runs.join('\n')).toContain('--source-ref refs/heads/main');
    expect(runs.join('\n')).toContain('--config "${CONFIG}"');
    expect(runs.join('\n')).toContain('--publish never');
    expect(stepText(jobs.build!)).toContain('electron-builder.commercial.generated.json');
  });

  it('never tags, pushes or uploads anything to GitHub', () => {
    for (const forbidden of [
      'gh release',
      'action-gh-release',
      'upload-release-asset',
      'actions/upload-artifact',
      'git tag',
      'git push',
      'releases/upload',
      'uploads.github.com',
      'contents: write',
      '--publish always',
      '--publish onTag',
    ])
      expect(text, forbidden).not.toContain(forbidden);
    const promote = stepText(jobs.promote!);
    expect(promote).toContain('node scripts/release-train.mjs promote');
    expect(text).not.toMatch(/node scripts\/publish-stable-release/u);
  });

  it('serializes publishers in the shared commercial group and never cancels them', () => {
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(workflow.concurrency.group).toBe(
      `release-train-\${{ inputs.action || (github.event.schedule == '${CUT_CRON}' && 'cut') || 'promote' }}`,
    );
    for (const name of ['build', 'promote'])
      expect(jobs[name]?.concurrency, name).toEqual({
        group: 'kerfdesk-commercial-publication',
        'cancel-in-progress': false,
      });
  });

  it('grants least privilege and names secrets only in the jobs that use them', () => {
    expect(workflow.permissions).toEqual({});
    for (const [name, job] of Object.entries(jobs)) {
      for (const [scope, access] of Object.entries(job.permissions ?? {}))
        expect(`${name} ${scope} ${access}`).toMatch(/ read$/u);
      const usesSecrets = stepText(job).includes('secrets.');
      expect(usesSecrets, name).toBe(['preflight', 'build', 'promote'].includes(name));
      if (usesSecrets) expect(job.environment, name).toBe('desktop-commercial');
    }
    // Secrets reach commands only through step environments, never inline.
    for (const job of Object.values(jobs))
      for (const step of job.steps ?? []) expect(step.run ?? '').not.toContain('secrets.');
    expect(text).not.toMatch(/set -x|echo .*\$\{\{ secrets/u);
    // The promotion needs the bucket, never the signing key.
    expect(stepText(jobs.promote!)).not.toContain('PRIVATE_KEY');
    expect(stepText(jobs.preflight!)).toContain(
      "secrets.COMMERCIAL_ESIGNER_PASSWORD != '' && 'set'",
    );
  });

  it('pins every external action to its reviewed commit', () => {
    const uses = [...text.matchAll(/uses: (\S+)/gu)].map((match) => match[1]!);
    for (const reference of uses.filter((item) => !item.startsWith('./')))
      expect(reference).toMatch(/@[0-9a-f]{40}$/u);
  });
});
