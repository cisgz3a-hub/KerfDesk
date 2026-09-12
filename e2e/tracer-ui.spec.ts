import { expect, test, type Page, type KerfDeskFixture } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { traceUiRequests: number };
    state.traceUiRequests = 0;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (!String(args[0]).includes('trace-worker')) return worker;
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (
          message: unknown,
          transfer?: Transferable[] | StructuredSerializeOptions,
        ): void => {
          state.traceUiRequests += 1;
          if (Array.isArray(transfer)) post(message, transfer);
          else post(message, transfer);
        };
        return worker;
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
});

test('inspects a trace without restarting the worker, edits with sliders, and commits it', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const dialog = await openTrace(page, kerfdesk);
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Sharp');
  await expect(dialog.getByText(/Trace ready/)).toBeVisible();
  const requestCount = await requests(page);
  expect(requestCount).toBeGreaterThan(0);
  const preview = dialog.locator('[aria-label="Trace preview (64x96 px)"]');
  await dialog.getByRole('button', { name: 'Show original image' }).click();
  await expect(preview).toBeHidden();
  await dialog.getByRole('button', { name: 'Show trace result' }).click();
  await expect(preview).toBeVisible();
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(dialog.getByLabel('Preview magnification')).toHaveText('2×');
  await dialog.getByRole('button', { name: 'Show Points', exact: true }).click();
  await expect(dialog.getByLabel('Trace points')).toBeVisible();
  await dialog.getByRole('button', { name: 'Show overlay' }).click();
  await dialog.getByRole('button', { name: 'Fade Image', exact: true }).click();
  await dialog.getByRole('button', { name: 'Fit', exact: true }).click();
  // Allow the normal 300 ms trace debounce to reveal an accidental request.
  await page.waitForTimeout(450);
  expect(await requests(page)).toBe(requestCount);

  await dialog.getByRole('combobox', { name: 'Trace detection' }).selectOption('manual');
  const slider = dialog.getByRole('slider', { name: 'Trace Threshold slider', exact: true });
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(
    dialog.getByRole('spinbutton', { name: 'Trace Threshold', exact: true }),
  ).toHaveValue('129');
  await expect(dialog.getByText('Settings edited', { exact: true })).toBeVisible();
  await dialog.getByText('Curve finishing', { exact: true }).click();
  await expect(
    dialog.getByRole('slider', { name: 'Trace Smoothness slider', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Reset trace settings', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Trace detection' })).toHaveValue('preset');
  await expect(dialog.getByText('Settings edited', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/Trace ready/)).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('tracer-desktop.png') });

  const submit = dialog.getByRole('button', { name: 'Trace', exact: true });
  await dialog.getByRole('button', { name: 'Close trace image' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(submit).toBeFocused();
  await submit.click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Save As...', exact: true }).click();
  const saved = Object.values(await kerfdesk.savedFiles()).find((text) =>
    text.includes('traced-image'),
  );
  expect(saved).toBeDefined();
  if (saved === undefined) throw new Error('Missing saved trace project');
  const project = JSON.parse(saved) as { scene: { objects: { kind: string }[] } };
  expect(project.scene.objects.filter((object) => object.kind === 'traced-image')).toHaveLength(1);
  expect(project.scene.objects.some((object) => object.kind === 'raster-image')).toBe(true);
});

test('keeps the preview and actions usable on a narrow screen and restores focus on Escape', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const dialog = await openTrace(page, kerfdesk);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByText(/Trace ready/)).toBeVisible();
  const panel = dialog.locator('form');
  const dimensions = await panel.evaluate((node) => ({
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
  expect(dimensions.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole('button', { name: 'Trace', exact: true })).toBeInViewport();
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Edge Detection');
  await expect(
    dialog.getByRole('spinbutton', { name: 'Trace Sensitivity', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Trace output' }).selectOption('raster');
  await expect(dialog.getByText(/Original grayscale shading is not retained/)).toBeVisible();
  await expect(dialog.getByText(/Trace ready/)).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('tracer-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Trace Image...', exact: true })).toBeFocused();
  await expect(page.getByText('Objects: 2', { exact: true })).toBeVisible();
});

async function openTrace(page: Page, fixture: KerfDeskFixture) {
  await fixture.setOpenFiles([
    { name: 'tracer-ui.png', kind: 'png-fixture', width: 64, height: 96 },
  ]);
  await page.getByRole('button', { name: 'Import...', exact: true }).click();
  await expect(page.getByText('Objects: 2', { exact: true })).toBeVisible();
  const notifications = page.getByRole('button', { name: /^Dismiss .* notification:/ });
  while (await notifications.count()) await notifications.first().click();
  await page.getByRole('button', { name: 'Trace Image...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function requests(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as typeof window & { traceUiRequests: number }).traceUiRequests,
  );
}

test('keeps boundary controls reachable in a short landscape window', async ({
  page,
  kerfdesk,
}) => {
  const dialog = await openTrace(page, kerfdesk);
  await expect(dialog.getByText(/Trace ready/)).toBeVisible();
  const viewport = dialog.getByRole('region', { name: 'Preview viewport' });
  const bounds = await viewport.boundingBox();
  if (bounds === null) throw new Error('Missing preview');
  await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.6);
  await page.mouse.up();
  const boundary = dialog.getByRole('combobox', { name: 'Trace boundary mode' });
  await expect(boundary).toBeVisible();
  await page.setViewportSize({ width: 700, height: 400 });
  expect(await viewport.evaluate((node) => node.clientHeight)).toBeGreaterThanOrEqual(150);
  await boundary.scrollIntoViewIfNeeded();
  await expect(boundary).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Trace', exact: true })).toBeInViewport();
  await boundary.selectOption('enhance');
  await expect(dialog.getByText(/Trace ready/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear Boundary', exact: true }).click();
  await expect(boundary).toHaveCount(0);
});
