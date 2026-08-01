import { expect, test, type Page } from './fixtures/kerfdesk-test';

const LARGE_SEGMENT_COUNT = 260_100;
const LARGE_PROGRAM = `G21 G90\n${'G1 X1\nG1 X0\n'.repeat(LARGE_SEGMENT_COUNT / 2)}`;

test('opens a large G-code file through the real production worker', async ({ page, kerfdesk }) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'large-worker.nc', text: LARGE_PROGRAM }]);
  await startHeartbeat(page);

  await runMenuCommand(page, 'File', 'Open G-code...');
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: large-worker.nc' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('all 260,100 segments are shown', {
    timeout: 60_000,
  });

  expect(workerUrls.some((url) => url.includes('gcode-inspector-worker'))).toBe(true);
  expect(await stopHeartbeat(page)).toBeGreaterThan(5);
});

test('Close cancels an active real-worker Inspector parse', async ({ page, kerfdesk }) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');
  await kerfdesk.setOpenFiles([
    {
      name: 'cancel-worker.nc',
      text: `G21 G90\n${'G1 X1\nG1 X0\n'.repeat(400_000)}`,
    },
  ]);

  await runMenuCommand(page, 'File', 'Open G-code...');
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: cancel-worker.nc' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/worker.*cancel/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await expect(dialog).toBeHidden();
  expect(workerUrls.some((url) => url.includes('gcode-inspector-worker'))).toBe(true);
});

test('real production worker runs queued Inspector requests in FIFO order', async ({ page }) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  const result = await page.evaluate(async (largeProgram) => {
    interface Progress {
      readonly phase: 'queued' | 'reading' | 'parsing';
      readonly queuePosition: number;
    }
    interface Inspection {
      readonly sourceLineCount: number;
    }
    interface ClientApi {
      inspectGcodeOffThread: (
        source: { readonly kind: 'text'; readonly text: string },
        options?: { readonly onProgress?: (progress: Progress) => void },
      ) => Promise<Inspection> | null;
      resetGcodeInspectorWorkerForTests: () => void;
    }

    const modulePath = '/src/ui/gcode-inspector/gcode-inspector-worker-client.ts';
    const loaded: unknown = await import(/* @vite-ignore */ modulePath);
    const client = loaded as Partial<ClientApi>;
    if (
      typeof client.inspectGcodeOffThread !== 'function' ||
      typeof client.resetGcodeInspectorWorkerForTests !== 'function'
    ) {
      throw new Error('G-code Inspector production client is unavailable');
    }

    const secondProgress: Progress[] = [];
    try {
      const first = client.inspectGcodeOffThread(
        { kind: 'text', text: largeProgram },
        { onProgress: () => undefined },
      );
      const second = client.inspectGcodeOffThread(
        { kind: 'text', text: 'G21 G90\nG1 X1\n' },
        { onProgress: (progress) => secondProgress.push(progress) },
      );
      if (first === null || second === null) throw new Error('Worker client returned no request');
      const [firstResult, secondResult] = await Promise.all([first, second]);
      return {
        firstSourceLineCount: firstResult.sourceLineCount,
        secondSourceLineCount: secondResult.sourceLineCount,
        secondProgress,
      };
    } finally {
      client.resetGcodeInspectorWorkerForTests();
    }
  }, LARGE_PROGRAM);

  expect(result.firstSourceLineCount).toBeGreaterThan(260_000);
  expect(result.secondSourceLineCount).toBe(3);
  expect(result.secondProgress[0]).toEqual({ phase: 'queued', queuePosition: 1 });
  expect(result.secondProgress.some((progress) => progress.phase === 'parsing')).toBe(true);
  expect(workerUrls.some((url) => url.includes('gcode-inspector-worker'))).toBe(true);
});

test('real production import worker parses G-code for the 2D preview path', async ({ page }) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  const result = await page.evaluate(async () => {
    interface ParsedGcode {
      readonly kind: 'ok' | 'error';
      readonly toolpath?: { readonly steps: readonly unknown[] };
    }
    interface ClientApi {
      parseGcodeOffThread: (blob: Blob) => Promise<ParsedGcode> | null;
      resetImportWorkerForTests: () => void;
    }
    const modulePath = '/src/ui/import/import-worker-client.ts';
    const loaded: unknown = await import(/* @vite-ignore */ modulePath);
    const client = loaded as Partial<ClientApi>;
    if (
      typeof client.parseGcodeOffThread !== 'function' ||
      typeof client.resetImportWorkerForTests !== 'function'
    ) {
      throw new Error('production import worker client is unavailable');
    }
    try {
      const pending = client.parseGcodeOffThread(new Blob(['G21 G90\nG0 X0 Y0\nG1 X10 Y0\n']));
      if (pending === null) throw new Error('production import worker could not be constructed');
      return await pending;
    } finally {
      client.resetImportWorkerForTests();
    }
  });

  expect(result.kind).toBe('ok');
  expect(result.toolpath?.steps.length).toBeGreaterThan(0);
  expect(
    workerUrls.some(
      (url) => url.includes('/import-worker') && !url.includes('document-import-worker'),
    ),
  ).toBe(true);
});

async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  await page.getByText(family, { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: command }).click();
}

async function startHeartbeat(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { ticks: 0, timer: 0 };
    state.timer = window.setInterval(() => {
      state.ticks += 1;
    }, 10);
    (
      window as typeof window & {
        __GCODE_WORKER_HEARTBEAT__?: { ticks: number; timer: number };
      }
    ).__GCODE_WORKER_HEARTBEAT__ = state;
  });
}

async function stopHeartbeat(page: Page): Promise<number> {
  return page.evaluate(() => {
    const target = window as typeof window & {
      __GCODE_WORKER_HEARTBEAT__?: { ticks: number; timer: number };
    };
    const state = target.__GCODE_WORKER_HEARTBEAT__;
    if (state === undefined) return 0;
    window.clearInterval(state.timer);
    delete target.__GCODE_WORKER_HEARTBEAT__;
    return state.ticks;
  });
}
