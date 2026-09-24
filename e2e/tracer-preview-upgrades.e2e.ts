import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

const portrait = readFileSync(
  fileURLToPath(new URL('../src/__fixtures__/perceptual/assets/astronaut.png', import.meta.url)),
).toString('base64');

declare global {
  interface Window {
    __tracerUpgradeProbe: { photoRequests: number; phases: string[]; errors: string[] };
  }
}

test.use({ viewport: { width: 1366, height: 768 }, trace: 'off' });

test('cached preset switching and dense point inspection work in the actual tracer dialog', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__tracerUpgradeProbe = { photoRequests: 0, phases: [], errors: [] };
    window.Worker = new Proxy(window.Worker, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        const worker = Reflect.construct(target, args) as Worker;
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (...parameters: Parameters<Worker['postMessage']>) => {
          const request = parameters[0] as { options?: { photoDetail?: number } };
          if (request.options?.photoDetail === 30) window.__tracerUpgradeProbe.photoRequests += 1;
          Reflect.apply(post, worker, parameters);
        };
        worker.addEventListener('message', (event: MessageEvent<{ phase?: string }>) => {
          if (event.data.phase !== undefined)
            window.__tracerUpgradeProbe.phases.push(event.data.phase);
        });
        return worker;
      },
    });
  });
  await page.goto('/');
  await page.evaluate((base64) => {
    const file = new File(
      [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
      'preview-portrait.png',
      { type: 'image/png' },
    );
    Object.assign(window, {
      showOpenFilePicker: async () => [
        { kind: 'file', name: file.name, getFile: async () => file },
      ],
    });
  }, portrait);
  await (await toolbarCommand(page, 'Import...')).click();
  await (await toolbarCommand(page, 'Trace Image...')).click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  const preset = dialog.getByRole('combobox', { name: 'Trace preset' });
  await preset.selectOption('Photo shading');
  const detail = dialog.getByRole('spinbutton', { name: 'Trace Detail', exact: true });
  await detail.fill('30');
  await detail.blur();
  await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 60000 });
  const before = await page.evaluate(() => window.__tracerUpgradeProbe.photoRequests);
  expect(before).toBeGreaterThan(0);
  const pointTiming = await dialog
    .getByRole('button', { name: 'Show Points', exact: true })
    .evaluate(async (button) => {
      const start = performance.now();
      (button as HTMLButtonElement).click();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return performance.now() - start;
    });
  const points = dialog.locator('canvas[aria-label="Trace points"]');
  await expect(points).toHaveCount(1);
  await expect(dialog.locator('.lf-trace-preview__points circle')).toHaveCount(0);
  const painted = await points.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Missing point overlay context');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      width: canvas.width,
      height: canvas.height,
      ink: pixels.some((value, index) => index % 4 === 3 && value !== 0),
    };
  });
  expect(painted.ink).toBe(true);
  expect(painted.width * painted.height).toBeLessThanOrEqual(4194304);
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await dialog.getByRole('region', { name: 'Preview viewport' }).evaluate((viewport) => {
    viewport.scrollLeft += 100;
    viewport.scrollTop += 80;
  });
  await expect(points).toBeVisible();
  await dialog.getByRole('button', { name: 'Show original image', exact: true }).click();
  await expect(points).toBeHidden();
  await dialog.getByRole('button', { name: 'Show overlay', exact: true }).click();
  await expect(points).toBeVisible();
  await dialog.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.setViewportSize({ width: 1180, height: 720 });
  await expect(points).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('dense-points.png') });
  await preset.selectOption('Sharp');
  await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 60000 });
  await preset.selectOption('Photo shading');
  // Return to the exact cached settings, including the retained Detail override.
  await detail.fill('30');
  await detail.blur();
  await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 60000 });
  expect(await page.evaluate(() => window.__tracerUpgradeProbe.photoRequests)).toBe(before);
  await expect(dialog.getByRole('spinbutton', { name: 'Trace Midtones', exact: true })).toHaveValue(
    '1',
  );
  await dialog.getByText('Photo output tips', { exact: true }).click();
  await expect(dialog.getByText(/Source size:/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Trace', exact: true })).toBeInViewport();
  await dialog.screenshot({ path: testInfo.outputPath('photo-output-controls.png') });
  const probe = await page.evaluate(() => window.__tracerUpgradeProbe);
  expect(probe.phases).toContain('tracing');
  expect(probe.phases).toContain('refining');
  expect(errors).toEqual([]);
  await testInfo.attach('preview-observations.json', {
    body: JSON.stringify({ pointTiming, painted, probe, errors }, null, 2),
    contentType: 'application/json',
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
});
