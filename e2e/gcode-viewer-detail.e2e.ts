import { expect, test, type Page } from './fixtures/kerfdesk-test';

// A 3D relief finish: 120 rows of 1,000 moves, each a tenth of a millimetre,
// with the depth changing on every move. Enough moves for the view to draw it
// simplified when zoomed out.
const ROWS = 120;
const STEPS_PER_ROW = 1000;
const MOVES = ROWS * STEPS_PER_ROW;

function relief(): string {
  const lines = ['G21 G90', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F1200'];
  for (let row = 0; row < ROWS; row += 1) {
    const y = row * 0.25;
    for (let step = 1; step <= STEPS_PER_ROW; step += 1) {
      const x = (row % 2 === 0 ? step : STEPS_PER_ROW - step) * 0.1;
      const z = -3 + 2 * Math.sin(x / 5) * Math.cos(y / 7);
      lines.push(`X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)}`);
    }
  }
  lines.push('G0 Z5');
  return lines.join('\n');
}

// Records the most lines any one draw call on the toolpath canvas drew.
async function trackLinesDrawn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const most = { lines: 0 };
    Object.assign(window, {
      __mostLinesDrawn: () => {
        const found = most.lines;
        most.lines = 0;
        return found;
      },
    });
    const proto = WebGL2RenderingContext.prototype;
    const { drawElementsInstanced } = proto;
    proto.drawElementsInstanced = function (
      this: WebGL2RenderingContext,
      mode: number,
      count: number,
      type: number,
      offset: number,
      instances: number,
    ) {
      drawElementsInstanced.call(this, mode, count, type, offset, instances);
      const canvas = this.canvas as HTMLCanvasElement;
      if (canvas.getAttribute('aria-label') === '3D G-code toolpath') {
        most.lines = Math.max(most.lines, instances);
      }
    };
  });
}

test('a big program is drawn simplified when zoomed out, and says so (ADR-485)', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await trackLinesDrawn(page);
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'detail-relief.nc', text: relief() }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: detail-relief.nc' });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 150_000 });
  const mostLinesDrawn = (): Promise<number> =>
    page.evaluate(() =>
      (window as unknown as { __mostLinesDrawn: () => number }).__mostLinesDrawn(),
    );

  // Fitted to the view, the relief is drawn with far fewer lines than moves.
  const note = dialog.locator('.gcode-viewer-hud-note');
  await expect(note).toContainText(/^Simplified at this zoom: [\d,]+ lines for 120,00\d moves/);
  await expect(note).toContainText('Zoom in to see every move.');
  const drawn = Number(
    /: ([\d,]+) lines/.exec((await note.textContent()) ?? '')?.[1]?.replaceAll(',', ''),
  );
  expect(drawn).toBeLessThan(MOVES / 4);
  await page.waitForTimeout(600);
  expect(await mostLinesDrawn()).toBeLessThan(MOVES / 4);

  // Pointing at a move still finds it among every move.
  const view = dialog.getByLabel('3D G-code toolpath', { exact: true });
  const box = await view.boundingBox();
  if (box === null) throw new Error('view has no size');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(dialog.locator('.gcode-viewer-move-tip')).toContainText(/Line \d+ · Cut \(G1\)/);

  // Zoomed in far enough, every move is drawn and the note goes.
  await expect(async () => {
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(150);
    await expect(note).toHaveCount(0, { timeout: 100 });
  }).toPass({ timeout: 60_000 });
  // A lens change redraws the view without pointing at it.
  await page.mouse.move(2, 2);
  await page.waitForTimeout(600);
  await mostLinesDrawn();
  await dialog.getByLabel('Colour lens').selectOption('feed');
  await page.waitForTimeout(600);
  expect(await mostLinesDrawn()).toBeGreaterThanOrEqual(MOVES);

  // Zoomed back out and played part way, the done moves are drawn one by one.
  await dialog.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(note).toHaveCount(1);
  const slider = dialog.getByLabel('Program time');
  const track = await slider.boundingBox();
  if (track === null) throw new Error('timeline has no size');
  await page.mouse.click(track.x + track.width * 0.5, track.y + track.height / 2);
  await expect(note).toHaveCount(0);
  expect(problems).toEqual([]);
});
