import { test, expect } from './fixtures/kerfdesk-test';
import {
  connectAndHome,
  confirmJobReview,
  frameCurrentJob,
  dismissNotifications,
} from './fixtures/recovery-flow';

test('keeps second-pass actions reachable with selected-stroke feedback and capped power', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await dismissNotifications(page);
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  await complete.getByRole('button', { name: 'Darken selected areas…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Paint a second pass', exact: true });
  await expect(
    dialog.getByRole('img', { name: 'Paint second-pass areas on the saved engraving' }),
  ).toBeVisible();
  await dismissNotifications(page);
  const canvas = dialog.getByRole('img', {
    name: 'Paint second-pass areas on the saved engraving',
  });
  await dialog.getByLabel('Brush diameter (mm)').fill('6');
  await canvas.click();
  const maskBeforeSelection = await canvas
    .locator('canvas')
    .nth(1)
    .evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await dialog.getByRole('button', { name: 'Paint 1 · 100%', exact: true }).click();
  await expect
    .poll(() =>
      canvas
        .locator('canvas')
        .nth(2)
        .evaluate((node: HTMLCanvasElement) => {
          const context = node.getContext('2d');
          if (!context) throw new Error('Expected the selected-stroke canvas.');
          const data = context.getImageData(0, 0, node.width, node.height).data;
          return data.some((value, index) => index % 4 === 3 && value > 0);
        }),
    )
    .toBe(true);
  expect(
    await canvas
      .locator('canvas')
      .nth(1)
      .evaluate((node: HTMLCanvasElement) => node.toDataURL()),
  ).toBe(maskBeforeSelection);
  await dialog.getByRole('button', { name: 'Paintbrush', exact: true }).click();
  await dialog.getByLabel('Brush diameter (mm)').fill('1000');
  await dialog.getByLabel('Paint power (% of original)').fill('1000');
  await canvas.click();
  await dialog.getByRole('button', { name: 'Preview second pass', exact: true }).click();
  await expect(
    dialog.getByText('Some painted power is capped at the saved machine maximum.'),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Frame second pass', exact: true }),
  ).toBeEnabled();
  const results = [];
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1280, height: 600 },
    { width: 683, height: 384 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      const { useToastStore } = await import('/src/ui/state/toast-store.ts' as string);
      useToastStore.setState({
        toasts: [
          {
            id: 'workbench-notice',
            message:
              'Keep the workpiece in its saved position. This notification must leave the second-pass controls reachable.',
            variant: 'warning',
          },
        ],
      });
    });
    await expect(dialog.getByRole('region', { name: 'Notifications' })).toBeVisible();
    await page.waitForTimeout(150);
    const measurement = await dialog.evaluate((node) => {
      const panelNode = node.querySelector('.second-pass-workbench');
      const canvasNode = node.querySelector('.second-pass-canvas');
      const bodyNode = node.querySelector('.second-pass-body');
      if (!panelNode || !canvasNode || !bodyNode)
        throw new Error('Expected the second-pass workbench layout.');
      const panel = panelNode.getBoundingClientRect();
      const canvas = canvasNode.getBoundingClientRect();
      const buttons = [...node.querySelectorAll('.second-pass-footer button')].map((button) => {
        const b = button.getBoundingClientRect();
        return {
          text: button.textContent,
          top: b.top,
          bottom: b.bottom,
          visibleWithinPanel: b.top >= panel.top && b.bottom <= panel.bottom,
          hit:
            document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button') ===
            button,
        };
      });
      return {
        panel: {
          top: panel.top,
          bottom: panel.bottom,
          height: panel.height,
          overflow: getComputedStyle(panelNode).overflow,
        },
        canvas: { width: canvas.width, height: canvas.height },
        body: {
          height: bodyNode.clientHeight,
          scrollHeight: bodyNode.scrollHeight,
        },
        buttons,
      };
    });
    results.push({ viewport, ...measurement });
    await page.screenshot({
      path: testInfo.outputPath(`workbench-${viewport.width}x${viewport.height}.png`),
    });
  }
  await testInfo.attach('layout-measurements', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  for (const result of results)
    expect
      .soft(
        result.buttons.every((button) => button.visibleWithinPanel && button.hit),
        JSON.stringify(result),
      )
      .toBe(true);
  const shortViewport = results.at(-1);
  if (!shortViewport) throw new Error('Expected the short-viewport measurement.');
  expect(shortViewport.body.scrollHeight).toBeGreaterThan(shortViewport.body.height);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('settled dense second-pass pixels match a fresh vector draw after cached pan and zoom', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { SecondPassBackgroundCache } = await import(
      '/src/ui/laser/second-pass/second-pass-background-cache.ts' as string
    );
    const { drawSecondPassSegments } = await import(
      '/src/ui/laser/second-pass/second-pass-render-paths.ts' as string
    );
    const count = 30_000;
    const segments = new Float64Array(count * 5);
    const chunkBounds = new Float64Array(Math.ceil(count / 256) * 4);
    for (let i = 0; i < count; i += 1)
      segments.set(
        [
          (i % 300) / 3,
          Math.floor(i / 300) / 2,
          ((i % 300) + 1) / 3,
          Math.floor(i / 300) / 2,
          ((i % 255) + 1) / 255,
        ],
        i * 5,
      );
    for (let i = 0; i < chunkBounds.length; i += 4) chunkBounds.set([0, 0, 100, 50], i);
    const originalSegments = segments.slice();
    const drawing = { segments, chunkBounds, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 } };
    const preview = {
      ...drawing,
      segments: segments.slice(0, 5000),
      chunkBounds: chunkBounds.slice(0, Math.ceil(1000 / 256) * 4),
    };
    const scene = { drawing, preview, showPreview: true };
    const size = { width: 640, height: 400 };
    const canvas = document.createElement('canvas');
    const cache = new SecondPassBackgroundCache();
    cache.draw(canvas, scene, { x: 17, y: 23, scale: 4 }, size);
    const view = { x: -13, y: -17, scale: 5 };
    const whileMoving = cache.draw(canvas, scene, view, size);
    cache.draw(canvas, scene, view, size, true);
    const reference = document.createElement('canvas');
    reference.width = canvas.width;
    reference.height = canvas.height;
    const expected = reference.getContext('2d');
    const actual = canvas.getContext('2d');
    if (!expected || !actual) throw new Error('Expected browser canvas rendering.');
    expected.scale(reference.width / size.width, reference.height / size.height);
    expected.fillStyle = '#faf7ef';
    expected.fillRect(0, 0, size.width, size.height);
    drawSecondPassSegments(expected, drawing, view, size, 0.16);
    drawSecondPassSegments(expected, preview, view, size, 1, '#b64214');
    const expectedPixels = expected.getImageData(0, 0, reference.width, reference.height).data;
    const actualPixels = actual.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      whileMoving,
      identicalPixels: actualPixels.every((value, index) => value === expectedPixels[index]),
      unchangedEndpoints: segments.every((value, index) => value === originalSegments[index]),
    };
  });
  expect(result).toEqual({
    whileMoving: 'cached',
    identicalPixels: true,
    unchangedEndpoints: true,
  });
});
