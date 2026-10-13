import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

const project = JSON.parse(
  readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8'),
);
// More than 20,000 route steps activates the real asynchronous bitmap renderer.
project.scene.objects[0].bounds = { minX: 10, minY: 10, maxX: 110, maxY: 230 };
project.scene.objects[0].paths[0].polylines[0].points = [
  { x: 10, y: 10 },
  { x: 110, y: 10 },
  { x: 110, y: 230 },
  { x: 10, y: 230 },
];
project.scene.layers[0].mode = 'fill';
project.scene.layers[0].hatchSpacingMm = 0.05;
project.scene.layers[0].passes = 2;

for (const width of [1440, 900]) {
  test(`dense Preview keeps its layout still during playback at ${width}px`, async ({
    page,
    kerfdesk,
  }, testInfo) => {
    test.setTimeout(120_000);
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('#app-splash')).toHaveCount(0);
    await kerfdesk.setOpenFiles([{ name: 'dense-preview.lf2', text: JSON.stringify(project) }]);
    await (await toolbarCommand(page, 'Open...')).click();
    await expect(page).toHaveTitle(/dense-preview/);
    await (await toolbarCommand(page, 'Preview')).click();
    const play = page.getByRole('button', { name: 'Play route preview', exact: true });
    await expect(play).toBeEnabled();
    await expect.poll(() => workers.some((url) => url.includes('preview-route-worker'))).toBe(true);
    const status = page.getByText('Updating route view…', { exact: true });
    await expect(status).toBeHidden();

    // Details can make the dock scroll at narrow widths. Neither its height nor
    // its scrollbar should oscillate when worker frames arrive.
    if (width === 900) await page.getByText('Distances and time details', { exact: true }).click();
    await expect(status).toBeHidden();
    const baseline = await sampleLayout(page, 30);
    // The regression moves this button too; bypass its actionability stability
    // check so the assertions can report the actual changing layout bounds.
    await play.click({ force: true });
    const playback = await sampleLayout(page);
    await page
      .getByRole('button', { name: 'Pause route preview', exact: true })
      .click({ force: true });
    const settling = await sampleLayout(page);
    await expect(status).toBeHidden();
    const settled = await sampleLayout(page, 30);

    expect(playback.some((sample) => sample.pending)).toBe(true);
    expect(settled.every((sample) => !sample.pending)).toBe(true);
    const samples = [...baseline, ...playback, ...settling, ...settled];
    await testInfo.attach('layout-samples', {
      body: JSON.stringify(samples),
      contentType: 'application/json',
    });
    for (const key of [
      'canvasHeight',
      'canvasWidth',
      'dockHeight',
      'dockTop',
      'footerTop',
    ] as const) {
      const values = samples.map((sample) => sample[key]);
      expect(Math.max(...values) - Math.min(...values), key).toBeLessThan(0.1);
    }
    await page.screenshot({ path: testInfo.outputPath('stable-preview.png') });
  });
}

async function sampleLayout(page: Page, frames = 120) {
  return page
    .getByLabel('KerfDesk workspace', { exact: true })
    .evaluate(async (canvas, frameCount) => {
      const dock = document.querySelector('[aria-label="Preview playback"]');
      const footer = document.querySelector('.lf-workspace-sheet-footer');
      if (dock === null || footer === null) throw new Error('Preview layout is missing');
      const samples = [];
      for (let frame = 0; frame < frameCount; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const canvasRect = canvas.getBoundingClientRect();
        const dockRect = dock.getBoundingClientRect();
        const status = [...dock.querySelectorAll('[role="status"]')].find(
          (element) => element.textContent === 'Updating route view…',
        );
        samples.push({
          canvasHeight: canvasRect.height,
          canvasWidth: canvasRect.width,
          dockHeight: dockRect.height,
          dockTop: dockRect.top,
          footerTop: footer.getBoundingClientRect().top,
          pending: status !== undefined && getComputedStyle(status).visibility !== 'hidden',
        });
      }
      return samples;
    }, frames);
}
