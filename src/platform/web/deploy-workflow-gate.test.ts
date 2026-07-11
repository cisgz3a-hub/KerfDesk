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
    expect(repoFile('README.md')).toContain(liveReleaseUrl);
    expect(repoFile('README.md')).toContain(pagesFallbackUrl);
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

    expect(commandIndex(workflow, 'pnpm release:check')).toBeLessThan(publishIndex);

    const requiredBeforePublish = [
      'pnpm guard:repo',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm lint:electron',
      'pnpm format:check',
      'pnpm license-check',
      'pnpm audit:deps',
      'pnpm test',
      'pnpm build:web',
      'pnpm build:electron-main',
      'pnpm check:file-size',
    ];

    for (const command of requiredBeforePublish) {
      expect(releaseCheck, `release:check must include ${command}`).toContain(command);
    }
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
