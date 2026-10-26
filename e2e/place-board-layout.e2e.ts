import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

// Allow the complete workspace's first Vite transform in a fresh worktree.
test.setTimeout(120_000);

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1280, height: 620 },
  { width: 1024, height: 600 },
]) {
  test(`Place Board floats without resizing the canvas at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
    const originalCanvas = await elementBounds(canvas);
    await (await toolbarCommand(page, 'Place Board')).click();
    const panel = page.getByRole('region', { name: 'Place board', exact: true });
    await expect(panel).toBeVisible();
    expect(await elementBounds(canvas)).toEqual(originalCanvas);
    await expectPanelFits(canvas, panel);
    expect((await elementBounds(panel)).width).toBeLessThanOrEqual(260);
    expect((await elementBounds(panel)).height).toBeLessThanOrEqual(260);

    const beforeDrag = await elementBounds(panel);
    await dragPanelBy(page, panel, -90, 40);
    await expect.poll(async () => (await elementBounds(panel)).x).toBeLessThan(beforeDrag.x - 50);
    await expectPanelFits(canvas, panel);
    expect(await elementBounds(canvas)).toEqual(originalCanvas);

    // Only in-memory store callbacks are used. No controller/transport is opened.
    await simulateBoardOrigin(page);
    await panel.getByRole('button', { name: 'Capture corner', exact: true }).click();
    const setupOffer = page.getByRole('button', { name: 'Not now', exact: true });
    if (await setupOffer.isVisible()) {
      // This independent canvas notice can sit behind the floating tool. Move
      // the card clear before dismissing it, just as an operator would.
      const drawing = await elementBounds(canvas);
      const controls = await elementBounds(panel);
      await dragPanelBy(page, panel, drawing.x + 8 - controls.x, 0);
      await setupOffer.click();
    }
    await panel.getByRole('spinbutton', { name: 'Board width in mm' }).fill('240');
    await panel.getByRole('spinbutton', { name: 'Board height in mm' }).fill('160');
    const expandedCanvas = await elementBounds(canvas);
    await panel.getByRole('button', { name: 'Collapse Place Board controls' }).click();
    await expect(panel.getByRole('button', { name: 'Capture corner', exact: true })).toBeHidden();
    expect((await elementBounds(panel)).height).toBeLessThanOrEqual(40);
    expect((await elementBounds(panel)).width).toBeLessThanOrEqual(210);
    expect(await elementBounds(canvas)).toEqual(expandedCanvas);
    await panel.getByRole('button', { name: 'Expand Place Board controls' }).click();
    await expect(panel).toContainText('Corner 2 of 4');
    await expect(panel.getByRole('spinbutton', { name: 'Board width in mm' })).toHaveValue('240');
    await panel.getByRole('button', { name: 'Draw board at this size', exact: true }).click();
    await expect(panel).toContainText('Measured: 240.0 × 160.0 mm');

    const header = panel.locator('.lf-board-panel-header');
    const headerBefore = await header.boundingBox();
    await panel.locator('.lf-board-panel-content').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await header.boundingBox()).toEqual(headerBefore);
    await expect(panel.getByRole('button', { name: 'Close board capture panel' })).toBeInViewport();
    await expectPanelFits(canvas, panel);
    await expectOverlayMatchesCanvas(page, canvas);

    // Reset to the right edge so the canvas and its bottom-left marker stay free.
    await panel.getByRole('button', { name: 'Move Place Board panel' }).press('Home');
    const firstAnchor = page.locator('[data-board-anchor="bottom-left"]');
    await expect(firstAnchor).toBeVisible();
    const anchorBefore = await firstAnchor.boundingBox();
    const drawing = await elementBounds(canvas);
    await page.mouse.move(drawing.x + 30, drawing.y + drawing.height / 2);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => firstAnchor.boundingBox()).not.toEqual(anchorBefore);
    await expectOverlayMatchesCanvas(page, canvas);
    await page.mouse.move(4, 4);
    await page.screenshot({ path: testInfo.outputPath('place-board-floating.png') });

    await panel.getByRole('button', { name: 'Collapse Place Board controls' }).click();
    await firstAnchor.click();
    await expect(
      panel.getByRole('button', { name: 'Collapse Place Board controls' }),
    ).toBeDisabled();
    await expect(panel.locator('[data-board-active-check]')).toBeInViewport({ ratio: 0.5 });
    await expect(
      panel.getByText('Moving beam-off. Wait for the machine to settle at Idle.'),
    ).toBeInViewport();
  });
}

test('Place Board remembers its position and stays within the canvas on expansion and resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await (await toolbarCommand(page, 'Place Board')).click();
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  const panel = page.getByRole('region', { name: 'Place board', exact: true });
  const handle = panel.getByRole('button', { name: 'Move Place Board panel' });
  await expect(panel).toBeVisible();
  const initial = await elementBounds(panel);
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowDown', 'Home'].includes(event.key)) {
        document.documentElement.dataset.placeBoardKeyBubbled = 'true';
      }
    });
  });
  await handle.press('ArrowLeft');
  await handle.press('Shift+ArrowDown');
  expect((await elementBounds(panel)).x).toBeCloseTo(initial.x - 8, 0);
  expect((await elementBounds(panel)).y).toBeCloseTo(initial.y + 24, 0);
  await expect(page.locator('html')).not.toHaveAttribute('data-place-board-key-bubbled');
  const moved = await elementBounds(panel);
  await panel.getByRole('button', { name: 'Close board capture panel' }).click();
  await expect(panel).toBeHidden();
  await (await toolbarCommand(page, 'Place Board')).click();
  expect(await elementBounds(panel)).toEqual(moved);
  await panel.getByRole('button', { name: 'Collapse Place Board controls' }).click();
  await dragPanelBy(page, panel, 1000, 1000);
  await expectPanelFits(canvas, panel);
  await panel.getByRole('button', { name: 'Expand Place Board controls' }).click();
  await expectPanelFits(canvas, panel);
  await page.setViewportSize({ width: 1024, height: 600 });
  await expectPanelFits(canvas, panel);
  await dragPanelBy(page, panel, -1000, -1000);
  await expectPanelFits(canvas, panel);
  const drawing = await elementBounds(canvas);
  const controls = await elementBounds(panel);
  expect(controls.x).toBeCloseTo(drawing.x + 8, 0);
  expect(controls.y).toBeCloseTo(drawing.y + 8, 0);
});

async function dragPanelBy(page: Page, panel: Locator, dx: number, dy: number): Promise<void> {
  const handle = await elementBounds(panel.getByRole('button', { name: 'Move Place Board panel' }));
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

async function expectPanelFits(canvas: Locator, panel: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const drawing = await elementBounds(canvas);
      const controls = await elementBounds(panel);
      return (
        controls.x >= drawing.x + 7 &&
        controls.y >= drawing.y + 7 &&
        controls.x + controls.width <= drawing.x + drawing.width - 7 &&
        controls.y + controls.height <= drawing.y + drawing.height - 7
      );
    })
    .toBe(true);
}

async function expectOverlayMatchesCanvas(page: Page, canvas: Locator): Promise<void> {
  const drawing = await elementBounds(canvas);
  const overlay = await elementBounds(
    page.getByRole('group', { name: 'Board verification points' }),
  );
  for (const dimension of ['x', 'y', 'width', 'height'] as const) {
    expect(overlay[dimension]).toBeCloseTo(drawing[dimension], 0);
  }
}

async function elementBounds(element: Locator) {
  const bounds = await element.boundingBox();
  if (bounds === null) throw new Error('Expected a visible layout element');
  return bounds;
}

async function simulateBoardOrigin(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = '/src/ui/state/laser-store.ts';
    const { useLaserStore } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../src/ui/state/laser-store');
    useLaserStore.setState({
      connection: { kind: 'connected' },
      streamer: null,
      controllerOperation: null,
      motionOperation: null,
      pendingTransportWrites: 0,
      pendingUntrackedAcks: 0,
      wcoCache: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 10, y: 20, z: 0 },
        wPos: null,
        wco: null,
        feed: null,
        spindle: null,
      },
      setOriginHere: async () => undefined,
      // Leave a simulated point move pending so its controls must stay visible.
      jogToMachinePosition: () => new Promise<void>(() => undefined),
    });
  });
}
