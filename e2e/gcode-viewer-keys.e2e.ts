import { expect, test } from './fixtures/kerfdesk-test';

// A square cut one millimetre deep, with rapids and a plunge around it.
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

test('the focused 3D view plays, steps, turns and measures from the keyboard (ADR-470)', async ({
  page,
  kerfdesk,
}) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'keys-square.nc', text: SQUARE_PROGRAM }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: keys-square.nc' });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 30_000 });

  await dialog.getByLabel('3D G-code toolpath', { exact: true }).focus();
  await expect(dialog.locator('.gcode-viewer-view-hint')).toContainText('Space play');
  const slider = dialog.getByLabel('Program time');
  const hud = dialog.getByLabel('Viewer position');

  // Home, then one move at a time: the plunge ends on line 4, the first cut on line 5.
  await page.keyboard.press('Home');
  await expect(slider).toHaveValue('0');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(hud).toContainText('Line 4');
  await page.keyboard.press('ArrowRight');
  await expect(hud).toContainText('Line 5');
  await expect(hud).toContainText('X 80.00');
  await page.keyboard.press('ArrowLeft');
  await expect(hud).toContainText('Line 4');
  await page.keyboard.press('End');
  await expect(slider).toHaveValue((await slider.getAttribute('max')) ?? '');

  const play = dialog.getByRole('button', { name: /^(Play|Pause)$/ });
  await page.keyboard.press('Space');
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(play).toHaveAttribute('aria-pressed', 'false');

  // 2 is Top, which is orthographic; O switches back to perspective.
  const ortho = dialog.getByRole('button', { name: 'Ortho', exact: true });
  await page.keyboard.press('2');
  await expect(ortho).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('o');
  await expect(ortho).toHaveAttribute('aria-pressed', 'false');

  // Esc ends measuring without closing the Inspector; the next Esc closes it.
  const measure = dialog.getByRole('button', { name: 'Measure', exact: true });
  await page.keyboard.press('m');
  await expect(measure).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(measure).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog).toBeVisible();

  // A trail keeps the line shader compiling and drawing.
  await dialog.getByLabel('Playback trail').selectOption('5');
  await page.keyboard.press('Home');
  const box = await slider.boundingBox();
  if (box === null) throw new Error('timeline has no size');
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await dialog.getByLabel('3D G-code toolpath', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(problems).toEqual([]);
});
