import type { Project } from '../src/core/scene';
import { expect, test } from './fixtures/kerfdesk-test';
import { checkWorkspaceHover } from './fixtures/workspace-responsiveness';

interface RasterIdleReply {
  kind: string;
  plan?: { jobStart: { x: number; y: number } | null } | null;
}

declare global {
  interface Window {
    __rasterIdleResults: RasterIdleReply[];
    __rasterPreparationResults: { id: number; kind: string }[];
  }
}

test('an ordinary raster prepares its estimate, markers and full Preview in real workers while retaining its source', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(60_000);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.addInitScript(() => {
    const results: RasterIdleReply[] = [];
    window.__rasterIdleResults = results;
    window.__rasterPreparationResults = [];
    // Observe native worker completion; construction alone cannot prove markers worked.
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (String(args[0]).includes('idle-canvas-motion-worker')) {
          worker.addEventListener('message', (event: MessageEvent<RasterIdleReply>) => {
            results.push(event.data);
          });
        }
        if (String(args[0]).includes('preparation-worker')) {
          worker.addEventListener(
            'message',
            (event: MessageEvent<{ id: number; kind: string }>) => {
              window.__rasterPreparationResults.push({ id: event.data.id, kind: event.data.kind });
            },
          );
        }
        return worker;
      },
    });
  });
  await page.goto('/');
  await kerfdesk.setOpenFiles([
    { name: 'canvas-raster.png', kind: 'png-fixture', width: 600, height: 2400 },
  ]);
  await page.getByRole('button', { name: 'Import...', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Trace Image...', exact: true })).toBeEnabled();
  await expect.poll(() => workers.some((url) => url.includes('preparation-worker'))).toBe(true);
  await expect
    .poll(() => workers.some((url) => url.includes('idle-canvas-motion-worker')))
    .toBe(true);
  // This also covers successful async publication under the dev app's StrictMode.
  await expect(page.getByText(/^≈\s/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('ETA unavailable', { exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__rasterIdleResults.some(
          (reply) => reply.kind === 'ok' && reply.plan?.jobStart != null,
        ),
      ),
    )
    .toBe(true);
  const markerReplies = await page.evaluate(() => window.__rasterIdleResults);
  expect(markerReplies.every((reply) => reply.kind !== 'error')).toBe(true);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  const hover = await checkWorkspaceHover(page);
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('p');
  await expect(page.getByRole('slider', { name: 'Preview toolpath scrubber' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play route preview', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.getByText('ETA unavailable', { exact: true })).toHaveCount(0);
  const previewHover = await checkWorkspaceHover(page);
  const preparationReplies = await page.evaluate(() => window.__rasterPreparationResults);
  expect(preparationReplies.every((reply) => reply.kind !== 'error')).toBe(true);
  expect(preparationReplies.map((reply) => reply.kind)).toEqual(
    expect.arrayContaining(['estimate', 'transfer-start', 'transfer-chunk', 'transfer-complete']),
  );
  await page.getByRole('button', { name: 'Save As...', exact: true }).click();
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles()).length).toBeGreaterThan(0);
  const entry = Object.entries(await kerfdesk.savedFiles()).find(([name]) => name.endsWith('.lf2'));
  if (entry === undefined) throw Error('Saved raster project is missing');
  const project = JSON.parse(entry[1]) as Project;
  const raster = project.scene.objects.find((object) => object.kind === 'raster-image');
  if (raster?.kind !== 'raster-image') throw Error('Original raster was lost');
  if (raster.lumaBase64 === undefined) throw Error('Embedded raster pixels were lost');
  expect([raster.pixelWidth, raster.pixelHeight]).toEqual([600, 2400]);
  const luma = Buffer.from(raster.lumaBase64, 'base64');
  expect(luma.length).toBe(600 * 2400);
  expect(luma[100 * 600 + 100]).toBe(255);
  expect(luma[1200 * 600 + 300]).toBe(0);
  await testInfo.attach('raster-workspace-workers.json', {
    body: JSON.stringify({
      workers,
      hover,
      previewHover,
      preparationReplies,
      sourceSize: [raster.pixelWidth, raster.pixelHeight],
    }),
    contentType: 'application/json',
  });
});
