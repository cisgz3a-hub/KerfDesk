import { expect, test, type Page } from './fixtures/kerfdesk-test';
import {
  assertResponsivePhase,
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from './fixtures/browser-responsiveness';
import { installMixedCanvasProject, showGcodeCanvas } from './fixtures/mixed-canvas-project';

test('G-code canvas ownership cancels hidden idle planning without a delayed UI stall', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');
  await startResponsivenessProbe(page);

  const idleWorkerStarted = page.waitForEvent('worker', {
    predicate: (worker) => worker.url().includes('idle-canvas-motion-worker'),
    timeout: 10_000,
  });
  await installMixedCanvasProject(page);
  await idleWorkerStarted;
  await showGcodeCanvas(page);

  await expect(page.getByLabel('G-code canvas view')).toBeVisible();
  await expect(page.locator('[aria-label$=" workspace"]')).toHaveCount(0);
  await expect(page.getByTestId('canvas-motion-layer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  await expect(page.getByLabel('Playback', { exact: true })).toBeVisible({ timeout: 60_000 });
  // Leave a delivery window after the real output worker has completed. A
  // stale idle reply used to commit and draw under this covering view here.
  await page.waitForTimeout(750);

  await expect(page.locator('[aria-label$=" workspace"]')).toHaveCount(0);
  await expect(page.getByTestId('canvas-motion-layer')).toHaveCount(0);
  const initialOpen = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'G-code canvas initial open', initialOpen);

  await startResponsivenessProbe(page);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  await expect(page.getByLabel('Playback', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(750);
  const refresh = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'G-code canvas Refresh', refresh);

  await startResponsivenessProbe(page);
  await runMenuCommand(page, 'File', 'Inspect G-code (3D)...');
  const inspector = page.getByRole('dialog', { name: /G-code Inspector: .*current canvas/ });
  await expect(inspector).toBeVisible({ timeout: 60_000 });
  await expect(inspector.getByLabel('Program health')).toBeVisible({ timeout: 60_000 });
  await expect(inspector.getByLabel('Playback', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(750);
  const inspectorOpen = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'explicit G-code Inspector open', inspectorOpen);
  await inspector.getByRole('button', { name: 'Close' }).click();

  expect(workerUrls.some((url) => url.includes('idle-canvas-motion-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('output-preparation-worker'))).toBe(true);
});

test('CNC Preview removal-grid simulation completes in the shared worker while UI stays responsive', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');
  await startResponsivenessProbe(page);

  const grid = await page.evaluate(async (rowCount) => {
    interface Vec2 {
      readonly x: number;
      readonly y: number;
    }
    interface Grid {
      readonly widthCells: number;
      readonly heightCells: number;
      readonly depth: Float32Array;
    }
    interface ProjectLike {
      readonly device: unknown;
      readonly machine: {
        readonly stock: {
          readonly originOffset: Vec2;
          readonly widthMm: number;
          readonly heightMm: number;
        };
      } | null;
    }
    interface RemovalClientApi {
      readonly prepareCncRemovalGridOffThread: (request: {
        readonly device: unknown;
        readonly machine: NonNullable<ProjectLike['machine']>;
        readonly toolpath: {
          readonly steps: readonly {
            readonly kind: 'cut';
            readonly color: string;
            readonly polyline: readonly [Vec2, Vec2];
            readonly length: number;
            readonly z: { readonly from: number; readonly to: number };
          }[];
          readonly totalLength: number;
        };
        readonly scrubFraction: number;
      }) => Promise<Grid | null> | null;
      readonly resetCncRemovalGridWorkerForTests: () => void;
    }
    interface FixtureApi {
      readonly mixedCanvasCompilationProject: () => ProjectLike;
    }
    interface DeviceApi {
      readonly toSceneCoords: (point: Vec2, device: unknown) => Vec2;
    }

    const clientPath = '/src/ui/workspace/cnc-removal-grid-worker-client.ts';
    const fixturePath = '/src/__fixtures__/mixed-canvas-compilation-project.ts';
    const devicePath = '/src/core/devices/index.ts';
    const [clientModule, fixtureModule, deviceModule] = await Promise.all([
      import(/* @vite-ignore */ clientPath),
      import(/* @vite-ignore */ fixturePath),
      import(/* @vite-ignore */ devicePath),
    ]);
    const client = clientModule as unknown as RemovalClientApi;
    const fixture = fixtureModule as unknown as FixtureApi;
    const devices = deviceModule as unknown as DeviceApi;
    const project = fixture.mixedCanvasCompilationProject();
    if (project.machine === null) throw new Error('mixed fixture is missing its CNC machine');
    const stock = project.machine.stock;
    const a = devices.toSceneCoords(stock.originOffset, project.device);
    const b = devices.toSceneCoords(
      {
        x: stock.originOffset.x + stock.widthMm,
        y: stock.originOffset.y + stock.heightMm,
      },
      project.device,
    );
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const length = maxX - minX;
    const steps = Array.from({ length: rowCount }, (_, index) => {
      const y = minY + ((index + 0.5) / rowCount) * (maxY - minY);
      const forward = index % 2 === 0;
      return {
        kind: 'cut' as const,
        color: '#000000',
        polyline: (forward
          ? [
              { x: minX, y },
              { x: maxX, y },
            ]
          : [
              { x: maxX, y },
              { x: minX, y },
            ]) as readonly [Vec2, Vec2],
        length,
        z: { from: -1, to: -1 },
      };
    });
    const startedAt = performance.now();
    try {
      const pending = client.prepareCncRemovalGridOffThread({
        device: project.device,
        machine: project.machine,
        toolpath: { steps, totalLength: length * steps.length },
        scrubFraction: 1,
      });
      if (pending === null) throw new Error('production removal-grid worker is unavailable');
      const result = await pending;
      if (result === null) throw new Error('production removal-grid worker returned no grid');
      return {
        widthCells: result.widthCells,
        heightCells: result.heightCells,
        retainedCells: result.depth.length,
        computeElapsedMs: performance.now() - startedAt,
      };
    } finally {
      client.resetCncRemovalGridWorkerForTests();
    }
  }, 180);

  const heartbeat = await stopResponsivenessProbe(page);
  testInfo.annotations.push({
    type: 'measurement',
    description: `direct removal grid: gridMs=${grid.computeElapsedMs.toFixed(1)}; cells=${grid.retainedCells}`,
  });
  assertResponsivePhase(testInfo, 'direct CNC removal grid', heartbeat);

  expect(grid.widthCells).toBeGreaterThan(0);
  expect(grid.heightCells).toBeGreaterThan(0);
  expect(grid.retainedCells).toBe(grid.widthCells * grid.heightCells);
  expect(workerUrls.some((url) => url.includes('cnc-removal-grid-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('canvas-compilation-worker'))).toBe(true);
});

async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  await page.getByText(family, { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: command }).click();
}
