// Audit telemetry, deliberately separate from CI performance acceptance budgets.
import { writeFileSync } from 'node:fs';
import { test, expect } from '../../e2e/fixtures/kerfdesk-test';
import {
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from '../../e2e/fixtures/browser-responsiveness';
import {
  installMixedCanvasProject,
  showGcodeCanvas,
} from '../../e2e/fixtures/mixed-canvas-project';

for (let trial = 1; trial <= 4; trial += 1) {
  test(`mixed canvas G-code open and Refresh telemetry ${trial}`, async ({
    page,
    context,
  }, info) => {
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.goto('/');
    await expect(page.locator('canvas[aria-label="KerfDesk workspace"]')).toBeVisible();
    // Warm fixture imports outside the measured interaction. Worker construction
    // and actual app work remain inside the measured phase.
    await page.evaluate(async () => {
      for (const path of [
        '/src/__fixtures__/mixed-canvas-compilation-project.ts',
        '/src/ui/state/store.ts',
        '/src/ui/state/canvas-view-store.ts',
      ]) {
        await import(/* @vite-ignore */ path);
      }
    });
    await page.waitForTimeout(500);
    const cdp = await context.newCDPSession(page);
    if (trial === 4) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    await startResponsivenessProbe(page);
    const started = Date.now();
    const idleStarted = page.waitForEvent('worker', {
      predicate: (worker) => worker.url().includes('idle-canvas-motion-worker'),
      timeout: 10_000,
    });
    await installMixedCanvasProject(page);
    await idleStarted;
    await showGcodeCanvas(page);
    await expect(page.getByLabel('G-code canvas view')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
      timeout: 60_000,
    });
    await expect(page.getByLabel('Playback estimate', { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const readyMs = Date.now() - started;
    await expect(page.locator('.gcode-viewer-viewport')).toHaveAttribute(
      'data-viewer-state',
      'ready',
      { timeout: 60_000 },
    );
    const renderedReadyMs = Date.now() - started;
    await page.waitForTimeout(750);
    const open = await stopResponsivenessProbe(page);
    await startResponsivenessProbe(page);
    const refreshStarted = Date.now();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
      timeout: 60_000,
    });
    await expect(page.getByLabel('Playback estimate', { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const refreshReadyMs = Date.now() - refreshStarted;
    await expect(page.locator('.gcode-viewer-viewport')).toHaveAttribute(
      'data-viewer-state',
      'ready',
      { timeout: 60_000 },
    );
    const refreshRenderedReadyMs = Date.now() - refreshStarted;
    await page.waitForTimeout(750);
    const refresh = await stopResponsivenessProbe(page);
    const receipt = {
      trial,
      profiled: trial === 4,
      readyMs,
      renderedReadyMs,
      refreshReadyMs,
      refreshRenderedReadyMs,
      open,
      refresh,
      workers,
    };
    writeFileSync(info.outputPath('measurement.json'), JSON.stringify(receipt, null, 2));
    info.annotations.push({ type: 'measurement', description: JSON.stringify(receipt) });
    if (trial === 4) {
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(info.outputPath('mixed-canvas.cpuprofile'), JSON.stringify(profile));
    }
    await page.screenshot({ path: info.outputPath('mixed-canvas.png') });
    expect(workers.some((url) => url.includes('output-preparation-worker'))).toBe(true);
  });
}
