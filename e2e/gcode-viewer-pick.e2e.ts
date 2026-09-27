import { expect, test, type Page } from './fixtures/kerfdesk-test';

// A square cut one millimetre deep, with rapids and a plunge around it. The
// Inspector frames it in the middle of the view, so the middle row of the
// canvas crosses its sides.
const SQUARE_PROGRAM = [
  'G21 G90',
  'G0 Z5',
  'G0 X0 Y0',
  'G1 Z-1 F300',
  'G1 X80 Y0 F900',
  'G1 X80 Y80',
  'G1 X0 Y80',
  'G1 X0 Y0',
  'G0 Z5',
].join('\n');
const SCAN_STEP_PX = 4;
// Far enough past a found move that the next sweep starts clear of it.
const SCAN_CLEAR_PX = 40;
// Long enough for a view change's camera animation to finish.
const VIEW_SETTLE_MS = 1_200;

test('hovering a move reads it out, and clicking it goes to its line (ADR-470)', async ({
  page,
  kerfdesk,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'pick-square.nc', text: SQUARE_PROGRAM }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: pick-square.nc' });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 30_000 });

  const card = dialog.locator('.gcode-viewer-move-tip');
  const hit = await scanForMove(page, dialog.getByLabel('3D G-code toolpath', { exact: true }));
  await expect(card).toContainText(/Line [5-8] · Cut \(G1\)/);
  await expect(card).toContainText('F 900 mm/min');
  await expect(card).toContainText(/Reached at \d+:\d\d/);
  const line = /Line (\d+)/.exec((await card.textContent()) ?? '')?.[1];

  await page.mouse.down();
  await page.mouse.up();
  await expect(dialog.getByLabel('Viewer position')).toContainText(`Line ${line}`);
  const slider = dialog.getByLabel('Program time');
  const position = Number(await slider.inputValue());
  expect(position).toBeGreaterThan(0);
  expect(position).toBeLessThan(Number(await slider.getAttribute('max')));

  await page.mouse.move(hit.x, hit.y - 400);
  await expect(card).toHaveCount(0);

  // The Studio look and an orthographic plan view pick the same moves.
  await dialog.getByRole('button', { name: 'Studio', exact: true }).click();
  await dialog.getByRole('button', { name: 'Top', exact: true }).click();
  await page.waitForTimeout(VIEW_SETTLE_MS);
  await scanForMove(page, dialog.getByLabel('3D G-code toolpath', { exact: true }));
  await expect(card).toContainText(/Line [68] · Cut \(G1\)/);
  await expect(card).toContainText(/X (0|80)\.00 {3}Y \d+\.\d\d {3}Z -1\.00 mm/);
  expect(pageErrors).toEqual([]);
});

// The same square cut in three passes, at Z -1, -2 and -3.
const POCKET_PROGRAM = ['G21 G90', 'G0 Z5']
  .concat(
    ...[-1, -2, -3].map((depth) => [
      'G0 X0 Y0',
      `G1 Z${depth} F300`,
      'G1 X80 Y0 F900',
      'G1 X80 Y80',
      'G1 X0 Y80',
      'G1 X0 Y0',
      'G0 Z5',
    ]),
  )
  .join('\n');

test('the Z range and legend filters decide what is drawn and pointed at (ADR-470)', async ({
  page,
  kerfdesk,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'pick-pocket.nc', text: POCKET_PROGRAM }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: pick-pocket.nc' });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 30_000 });

  // Keep only the -2 pass: the stops run -3, -2, -1, 5.
  const highest = dialog.getByTitle('Hide every move above this height');
  await highest.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const lowest = dialog.getByTitle('Hide every move below this height');
  await lowest.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(highest).toHaveAttribute('aria-valuetext', '-2.00 mm');
  await expect(lowest).toHaveAttribute('aria-valuetext', '-2.00 mm');

  const card = dialog.locator('.gcode-viewer-move-tip');
  const hit = await scanForMove(page, dialog.getByLabel('3D G-code toolpath', { exact: true }));
  await expect(card).toContainText(/Z -2\.00 mm/);

  await dialog.getByLabel('Colour lens').selectOption('kind');
  await dialog.getByTitle('Hide cut moves').click();
  await page.mouse.move(hit.x, hit.y - 1);
  await page.mouse.move(hit.x, hit.y);
  await expect(card).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('measuring between two moves reads their distance (ADR-470)', async ({ page, kerfdesk }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'measure-square.nc', text: SQUARE_PROGRAM }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: measure-square.nc' });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Top', exact: true }).click();
  await page.waitForTimeout(VIEW_SETTLE_MS);

  const measure = dialog.getByRole('button', { name: 'Measure', exact: true });
  await measure.click();
  await expect(measure).toHaveAttribute('aria-pressed', 'true');
  const hud = dialog.getByLabel('Viewer position');
  await expect(hud).toContainText('Measure: click a first point');

  // Seen from above, the middle row crosses the square's two sides at the
  // same Y, so the two points are exactly the square's width apart.
  const canvas = dialog.getByLabel('3D G-code toolpath', { exact: true });
  const card = dialog.locator('.gcode-viewer-move-tip');
  const first = await scanForMove(page, canvas);
  await expect(card).toContainText('Click to measure from here');
  await page.mouse.down();
  await page.mouse.up();
  await expect(hud).toContainText('Measure: click a second point');
  await scanForMove(page, canvas, first.x + SCAN_CLEAR_PX);
  await expect(card).toContainText('Click to measure to here');
  await page.mouse.down();
  await page.mouse.up();
  await expect(hud).toContainText('Distance 80.00 mm');
  await expect(hud).toContainText('ΔX 80.00');
  await expect(dialog.locator('.viewer3d-measure-label')).toHaveText('80.00 mm');

  // A click on a move now goes back to measuring from it; switching the tool
  // off clears the measurement and a click goes to the line again.
  await measure.click();
  await expect(hud).not.toContainText('Distance');
  await expect(dialog.locator('.viewer3d-measure-label')).toBeHidden();
  await scanForMove(page, canvas);
  await expect(card).toContainText('Click to go to this line');
  expect(pageErrors).toEqual([]);
});

// Sweeps the pointer along the canvas's middle row until the card names a cut.
async function scanForMove(
  page: Page,
  canvas: ReturnType<Page['locator']>,
  fromX?: number,
): Promise<{ readonly x: number; readonly y: number }> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('3D view has no size');
  const y = box.y + box.height / 2;
  const card = page.locator('.gcode-viewer-move-tip');
  for (let x = fromX ?? box.x + SCAN_STEP_PX; x < box.x + box.width; x += SCAN_STEP_PX) {
    await page.mouse.move(x, y);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    if ((await card.count()) > 0 && /Cut \(G1\)/.test((await card.textContent()) ?? '')) {
      return { x, y };
    }
  }
  throw new Error('No cut found along the middle of the 3D view');
}
