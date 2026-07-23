import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  checkForPreviewUpdate,
  createPreviewUpdateCheck,
  isExactPreviewUpdateApiRequest,
  PREVIEW_WORKFLOW_RUNS_API_URL,
  type PreviewUpdateCheckOptions,
} from './preview-update.js';

function workflowRun(
  tag: string,
  options: {
    readonly conclusion?: string;
    readonly event?: string;
    readonly headSha?: string;
    readonly path?: string;
    readonly status?: string;
  } = {},
): unknown {
  return {
    conclusion: options.conclusion ?? 'success',
    event: options.event ?? 'push',
    head_branch: tag,
    head_sha: options.headSha ?? 'a'.repeat(40),
    path: options.path ?? '.github/workflows/release-desktop-preview.yml',
    status: options.status ?? 'completed',
  };
}

function response(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), init);
}

function workflowResponse(runs: readonly unknown[], init?: ResponseInit): Response {
  return response({ workflow_runs: runs }, init);
}

function options(
  fetchWorkflowRuns: PreviewUpdateCheckOptions['fetchWorkflowRuns'],
  overrides: Partial<PreviewUpdateCheckOptions> = {},
): PreviewUpdateCheckOptions {
  return {
    enabled: true,
    currentVersion: '1.2.3-preview.4',
    platform: 'win32',
    arch: 'x64',
    fetchWorkflowRuns,
    ...overrides,
  };
}

describe('unsigned Preview update discovery', () => {
  it('serves the reserved API response as non-cacheable nosniff JSON', () => {
    const main = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');
    expect(main).toContain("'Cache-Control': 'no-store'");
    expect(main).toContain("'Content-Type': 'application/json; charset=utf-8'");
    expect(main).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it('accepts only the exact same-origin GET endpoint', () => {
    expect(
      isExactPreviewUpdateApiRequest({
        method: 'GET',
        url: 'app://app/api/desktop-preview-update',
      }),
    ).toBe(true);
    for (const request of [
      { method: 'POST', url: 'app://app/api/desktop-preview-update' },
      { method: 'GET', url: 'app://evil/api/desktop-preview-update' },
      { method: 'GET', url: 'https://app/api/desktop-preview-update' },
      { method: 'GET', url: 'app://app/api/desktop-preview-update?again=1' },
      { method: 'GET', url: 'app://app/api/desktop-preview-update#fragment' },
      { method: 'GET', url: 'not a url' },
    ]) {
      expect(isExactPreviewUpdateApiRequest(request)).toBe(false);
    }
  });

  it('uses one pinned anonymous no-cache GitHub metadata request', async () => {
    const fetchWorkflowRuns = vi.fn(() => Promise.resolve(workflowResponse([])));
    await checkForPreviewUpdate(options(fetchWorkflowRuns));
    expect(fetchWorkflowRuns).toHaveBeenCalledOnce();
    const [url, init] = fetchWorkflowRuns.mock.calls[0] ?? [];
    expect(url).toBe(PREVIEW_WORKFLOW_RUNS_API_URL);
    expect(init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(init?.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'KerfDesk-Desktop-Preview',
    });
  });

  it('selects the highest newer green Preview workflow regardless of API order', async () => {
    const fetchWorkflowRuns = vi.fn(() =>
      Promise.resolve(
        workflowResponse([
          workflowRun('v1.2.3-preview.5'),
          workflowRun('v2.0.0-preview.1'),
          workflowRun('v1.9.9-preview.99'),
        ]),
      ),
    );
    await expect(checkForPreviewUpdate(options(fetchWorkflowRuns))).resolves.toEqual({
      kind: 'available',
      version: '2.0.0-preview.1',
    });
  });

  it('compares arbitrarily large numeric identifiers without precision loss', async () => {
    const fetchWorkflowRuns = vi.fn(() =>
      Promise.resolve(workflowResponse([workflowRun('v9007199254740993.0.0-preview.0')])),
    );
    await expect(
      checkForPreviewUpdate(
        options(fetchWorkflowRuns, { currentVersion: '9007199254740992.0.0-preview.999' }),
      ),
    ).resolves.toEqual({
      kind: 'available',
      version: '9007199254740993.0.0-preview.0',
    });
  });

  it.each([
    ['failed run', workflowRun('v1.2.3-preview.5', { conclusion: 'failure' })],
    ['cancelled run', workflowRun('v1.2.3-preview.5', { conclusion: 'cancelled' })],
    ['in-progress run', workflowRun('v1.2.3-preview.5', { status: 'in_progress' })],
    ['non-push run', workflowRun('v1.2.3-preview.5', { event: 'workflow_dispatch' })],
    ['wrong workflow', workflowRun('v1.2.3-preview.5', { path: '.github/workflows/ci.yml' })],
    ['stable tag', workflowRun('v1.2.4')],
    ['leading zero', workflowRun('v1.2.3-preview.05')],
    ['malformed source SHA', workflowRun('v1.2.3-preview.5', { headSha: 'bad' })],
  ])('rejects a %s', async (_label, candidate) => {
    const fetchWorkflowRuns = vi.fn(() => Promise.resolve(workflowResponse([candidate])));
    await expect(checkForPreviewUpdate(options(fetchWorkflowRuns))).resolves.toEqual({
      kind: 'none',
    });
  });

  it('requires the current package itself to be a strict Preview build', async () => {
    const fetchWorkflowRuns = vi.fn(() =>
      Promise.resolve(workflowResponse([workflowRun('v1.2.3-preview.5')])),
    );
    await expect(
      checkForPreviewUpdate(options(fetchWorkflowRuns, { currentVersion: '1.2.3' })),
    ).resolves.toEqual({ kind: 'none' });
    expect(fetchWorkflowRuns).not.toHaveBeenCalled();
  });

  it('is inert when disabled or built for an unsupported target', async () => {
    const fetchWorkflowRuns = vi.fn(() => Promise.resolve(workflowResponse([])));
    await expect(
      checkForPreviewUpdate(options(fetchWorkflowRuns, { enabled: false })),
    ).resolves.toEqual({ kind: 'none' });
    await expect(
      checkForPreviewUpdate(options(fetchWorkflowRuns, { platform: 'linux' })),
    ).resolves.toEqual({ kind: 'none' });
    expect(fetchWorkflowRuns).not.toHaveBeenCalled();
  });

  it('fails silently for HTTP, malformed, oversized, and network failures', async () => {
    const onError = vi.fn();
    const cases = [
      vi.fn(() => Promise.resolve(workflowResponse([], { status: 403 }))),
      vi.fn(() => Promise.resolve(new Response('{bad-json'))),
      vi.fn(() =>
        Promise.resolve(
          new Response('{"workflow_runs":[]}', {
            headers: { 'content-length': String(513 * 1024) },
          }),
        ),
      ),
      vi.fn(() => Promise.resolve(new Response('x'.repeat(513 * 1024)))),
      vi.fn(() => Promise.reject(new Error('offline'))),
    ];
    for (const fetchWorkflowRuns of cases) {
      await expect(checkForPreviewUpdate(options(fetchWorkflowRuns, { onError }))).resolves.toEqual(
        {
          kind: 'none',
        },
      );
    }
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('coalesces repeated renderer requests to one check per app launch', async () => {
    const fetchWorkflowRuns = vi.fn(() => Promise.resolve(workflowResponse([])));
    const check = createPreviewUpdateCheck(options(fetchWorkflowRuns));
    await Promise.all([check(), check(), check()]);
    expect(fetchWorkflowRuns).toHaveBeenCalledOnce();
  });
});
