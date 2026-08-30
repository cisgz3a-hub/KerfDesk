import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function commandIndex(source: string, command: string): number {
  const index = source.indexOf(`run: ${command}`);
  expect(index, `missing workflow command: ${command}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('Cloudflare production deploy gate', () => {
  it('targets main as the Cloudflare Pages production branch', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');
    const packageJson = JSON.parse(repoFile('package.json')) as {
      scripts: Record<string, string>;
    };

    expect(workflow).toContain('--branch=main');
    expect(packageJson.scripts['deploy:web']).toContain('--branch=main');
    expect(workflow).not.toContain('--branch=master');
    expect(packageJson.scripts['deploy:web']).not.toContain('--branch=master');
  });

  it('targets the Cloudflare Pages API project that serves the canonical release URL', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');
    const packageJson = JSON.parse(repoFile('package.json')) as {
      scripts: Record<string, string>;
    };
    const pagesApiProject = '--project-name=laserforge';
    const liveReleaseUrl = 'kerfdesk.com';
    const pagesFallbackUrl = 'laserforge-2fj.pages.dev';

    expect(workflow).toContain(pagesApiProject);
    expect(packageJson.scripts['deploy:web']).toContain(pagesApiProject);
    expect(packageJson.scripts['deploy:web:preview']).toContain(pagesApiProject);
    // The canonical + fallback URLs are documented next to the deploy target in
    // the workflow itself — the durable source of truth — rather than the README,
    // which is a temporary placeholder while the repo is public (801e3838).
    expect(workflow).toContain(liveReleaseUrl);
    expect(workflow).toContain(pagesFallbackUrl);
  });

  it('only permits manual production deploys from the main branch', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).not.toContain(
      "github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'",
    );
  });

  // M33 (AUDIT-2026-06-10): for workflow_run events GITHUB_SHA is the default
  // branch's CURRENT tip — a push race (or a re-run of an old green CI) would
  // deploy a different commit than the one CI validated.
  it('checks out the CI-validated commit, not the branch tip', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(workflow).toContain('github.event.workflow_run.head_sha');
  });

  it('serializes candidates, no-ops obsolete reruns, and rechecks freshness after build', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');
    const resolver = 'resolve-web-deploy-identity.mjs';

    expect(workflow.match(new RegExp(resolver.replaceAll('.', '\\.'), 'g'))).toHaveLength(3);
    expect(
      workflow.match(
        /git fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main/gu,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain('current-main-sha="$(git rev-parse refs/remotes/origin/main)"');
    expect(workflow).toContain("if: ${{ steps.deployment_identity.outputs.eligible == 'true' }}");
    expect(workflow).toContain("if: ${{ steps.pre_publish_identity.outputs.eligible == 'true' }}");
    expect(workflow).toContain('group: deploy-production-main');
    expect(workflow).toContain('queue: max');
    expect(workflow).not.toContain('cancel-in-progress:');
    expect(workflow.indexOf('Reconfirm current main immediately before publication')).toBeLessThan(
      workflow.indexOf('uses: cloudflare/wrangler-action@'),
    );
  });

  it('uses current-main control code when an obsolete candidate predates the resolver', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(workflow).toContain('WORKFLOW_CONTROL_SHA: ${{ github.workflow_sha }}');
    expect(workflow).toContain(
      'git merge-base --is-ancestor "${WORKFLOW_CONTROL_SHA}" refs/remotes/origin/main',
    );
    expect(workflow).toContain(
      'git show "${WORKFLOW_CONTROL_SHA}:scripts/resolve-web-deploy-identity.mjs"',
    );
    expect(workflow).toContain('> "${control_resolver}"');
    expect(workflow).toContain('node "${control_resolver}"');
    expect(workflow).toContain('node "${RUNNER_TEMP}/resolve-web-deploy-identity.mjs"');
    expect(workflow).not.toContain('node scripts/resolve-web-deploy-identity.mjs');
    expect(workflow).toContain('Record obsolete run as an intentional non-deployment');
    expect(workflow).toContain('Record main advance during build as a non-deployment');
    expect(workflow).toContain(
      "steps.deployment_identity.outputs.eligible == 'true' && steps.pre_publish_identity.outputs.eligible == 'false'",
    );
    expect(workflow).toContain(
      "if: ${{ always() && steps.deployment_identity.outputs.eligible == 'true' }}",
    );
    expect(workflow).toContain(
      'No candidate-tree build, report script, or provider command was executed.',
    );
  });

  it('keeps checkout, readiness, and artifact naming on one deployment SHA', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(workflow).toContain('--sha=${DEPLOY_SHA}');
    expect(workflow).toContain('DEPLOY_SHA: ${{ steps.deployment_identity.outputs.sha }}');
    expect(workflow).toContain(
      'name: release-readiness-deploy-${{ steps.deployment_identity.outputs.sha }}',
    );
    expect(workflow).not.toContain('name: release-readiness-deploy-${{ github.sha }}');
    expect(workflow).toContain(
      "github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || 'refs/heads/main'",
    );
    expect(workflow).toContain('CI_STATE: ${{ steps.release_check.outcome }}');
    expect(workflow).toContain('validated-run=${TRIGGER_RUN_URL}');
    expect(workflow).not.toContain(
      "CI_STATE: ${{ github.event_name == 'workflow_run' && 'passed' || steps.release_check.outcome }}",
    );
  });

  it('runs repo identity proof and CI gates before Wrangler publishes', () => {
    const workflow = repoFile('.github/workflows/deploy.yml');
    const packageJson = JSON.parse(repoFile('package.json')) as {
      scripts: Record<string, string>;
    };
    const releaseCheck = packageJson.scripts['release:check'];
    // Match the publish step by action name only, not a pinned major — this
    // assertion guards ordering (gate before publish), so an action version
    // bump must not break it. Only one wrangler-action step exists in deploy.yml.
    const publishIndex = workflow.indexOf('uses: cloudflare/wrangler-action@');
    expect(publishIndex).toBeGreaterThanOrEqual(0);

    const repoGuardIndex = commandIndex(workflow, 'pnpm guard:repo');
    expect(commandIndex(workflow, 'pnpm release:check')).toBeLessThan(publishIndex);
    expect(repoGuardIndex).toBeLessThan(publishIndex);
    expect(releaseCheck).not.toContain('pnpm guard:repo');

    const requiredBeforePublish = [
      'pnpm typecheck',
      'pnpm lint',
      'pnpm lint:electron',
      'pnpm format:check',
      'pnpm license-check',
      'pnpm test',
      'pnpm build:web',
      'pnpm build:electron-main',
      'pnpm check:file-size',
    ];

    for (const command of requiredBeforePublish) {
      expect(releaseCheck, `release:check must include ${command}`).toContain(command);
    }

    expect(packageJson.scripts['deploy:web']).toMatch(/^pnpm guard:repo && pnpm release:check && /);
    expect(packageJson.scripts['deploy:web:preview']).toMatch(
      /^pnpm guard:repo && pnpm release:check && /,
    );
  });

  // ADR-254: the dependency audit deliberately does NOT gate merges or deploys.
  // A third-party advisory publication is not a defect in the diff under review,
  // and inside release:check's sequential `&&` chain it masked every verification
  // step after it. Pin both halves: the outage vector must not be restored by
  // reflex, and the audit must not quietly disappear either.
  it('runs the dependency audit on a schedule, not in the merge gate', () => {
    const packageJson = JSON.parse(repoFile('package.json')) as {
      scripts: Record<string, string>;
    };
    const auditWorkflow = repoFile('.github/workflows/audit.yml');

    expect(packageJson.scripts['release:check']).not.toContain('audit');
    expect(packageJson.scripts['audit:deps']).toBe('pnpm audit --audit-level=low');
    expect(auditWorkflow).toContain('pnpm audit --json');
    expect(auditWorkflow).toContain('pnpm audit --prod --json');
    expect(auditWorkflow).toContain('pnpm report:dependency-audit');
    expect(auditWorkflow).toContain('cron:');
  });

  it('repo guard accepts the canonical GitHub Actions remote without .git', () => {
    const root = mkdtempSync(join(tmpdir(), 'laserforge-repo-guard-'));
    const fakeRepo = join(root, 'LaserForge-2.0');
    mkdirSync(fakeRepo);
    writeFileSync(join(fakeRepo, 'index.html'), '<title>KerfDesk</title><div id="app-root"></div>');
    execFileSync('git', ['init'], { cwd: fakeRepo, stdio: 'ignore' });
    execFileSync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/cisgz3a-hub/LaserForge-2.0'],
      {
        cwd: fakeRepo,
        stdio: 'ignore',
      },
    );

    const nodeScript = join(process.cwd(), 'scripts/assert-correct-repo.mjs');

    try {
      const output = execFileSync(process.execPath, [nodeScript], {
        cwd: fakeRepo,
        encoding: 'utf8',
      });
      expect(output).toContain('Repository guard passed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  // 2026-07-03 rename: cisgz3a-hub/LaserForge-2.0 -> cisgz3a-hub/KerfDesk. The
  // guard rejected the new folder name + remote, so every Deploy run failed at
  // guard:repo and production went stale. Pin the new identity as accepted.
  it('repo guard accepts the KerfDesk identity after the 2026-07-03 rename', () => {
    const root = mkdtempSync(join(tmpdir(), 'kerfdesk-repo-guard-'));
    const fakeRepo = join(root, 'KerfDesk');
    mkdirSync(fakeRepo);
    writeFileSync(join(fakeRepo, 'index.html'), '<title>KerfDesk</title><div id="app-root"></div>');
    execFileSync('git', ['init'], { cwd: fakeRepo, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/cisgz3a-hub/KerfDesk'], {
      cwd: fakeRepo,
      stdio: 'ignore',
    });

    const nodeScript = join(process.cwd(), 'scripts/assert-correct-repo.mjs');

    try {
      const output = execFileSync(process.execPath, [nodeScript], {
        cwd: fakeRepo,
        encoding: 'utf8',
      });
      expect(output).toContain('Repository guard passed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
