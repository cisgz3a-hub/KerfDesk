import {
  expect,
  test,
  type KerfDeskFixture,
  type Locator,
  type Page,
} from './fixtures/kerfdesk-test';

// A 30 mm square pocket cleared 3 mm deep with a 6 mm end mill, one row at a
// time. The tool comment is the one KerfDesk writes.
function pocket(withTool: boolean): string {
  const lines = ['G21 G90'];
  if (withTool) lines.push('; cnc tool: end-mill; diameter-mm: 6');
  lines.push('G0 Z5', 'G0 X3 Y3', 'G1 Z-3 F300');
  for (let row = 0; row <= 8; row += 1) {
    const y = (3 + row * 3).toFixed(1);
    lines.push(`G1 X${row % 2 === 0 ? 27 : 3} Y${y} F900`);
    if (row < 8) lines.push(`G1 Y${(3 + (row + 1) * 3).toFixed(1)}`);
  }
  lines.push('G0 Z5');
  return lines.join('\n');
}

async function openProgram(
  page: Page,
  kerfdesk: KerfDeskFixture,
  name: string,
  text: string,
): Promise<Locator> {
  await kerfdesk.setOpenFiles([{ name, text }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: `G-code Inspector: ${name}` });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 30_000 });
  return dialog;
}

// Pixels of the view in the stock's warm wood colours, read from a screenshot.
async function woodPixels(page: Page, view: Locator): Promise<number> {
  const png = (await view.screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (context === null) return 0;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let wood = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      const [red, green, blue] = [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0];
      if (red > 90 && red >= green && green - blue > 15 && red - blue > 35) wood += 1;
    }
    return wood;
  }, png);
}

// A picture of the view once two taken in a row match.
async function settled(view: Locator): Promise<Buffer> {
  let last = await view.screenshot();
  await expect
    .poll(
      async () => {
        const next = await view.screenshot();
        const same = next.equals(last);
        last = next;
        return same;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return last;
}

test('the Inspector carves the stock as playback runs (ADR-487)', async ({ page, kerfdesk }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto('/');
  const dialog = await openProgram(page, kerfdesk, 'stock-pocket.nc', pocket(true));
  const view = dialog.getByLabel('3D G-code toolpath', { exact: true });
  const looks = dialog.getByRole('group', { name: '3D look' });
  const show = dialog.getByRole('checkbox', { name: 'Show carved stock' });
  const over = dialog.getByRole('checkbox', { name: 'Toolpath over the stock' });
  // A still camera, so pictures taken at the same place in the program match.
  await dialog
    .getByRole('group', { name: 'Camera mode' })
    .getByRole('button', { name: 'Manual' })
    .click();
  await expect(show).not.toBeChecked();
  await expect(over).toBeDisabled();
  const withoutStock = await woodPixels(page, view);

  // At the start of the program the stock is a whole block.
  await show.check();
  await view.focus();
  await page.keyboard.press('Home');
  await expect
    .poll(() => woodPixels(page, view), { timeout: 30_000 })
    .toBeGreaterThan(withoutStock + 20_000);
  const uncut = await settled(view);
  // The file gives its bit, so nothing is carved with a stand-in.
  await expect(dialog.getByText(/No bit size in the file/)).toHaveCount(0);

  // At the end the pocket is carved; back at the start it is whole again, and
  // at the end once more the same pocket is carved.
  await page.keyboard.press('End');
  await expect.poll(async () => (await view.screenshot()).equals(uncut)).toBe(false);
  const carved = await settled(view);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await view.screenshot()).equals(uncut)).toBe(true);
  await page.keyboard.press('End');
  await expect.poll(async () => (await view.screenshot()).equals(carved)).toBe(true);

  // The toolpath can be drawn over the stock, in both looks.
  await over.check();
  await expect.poll(async () => (await view.screenshot()).equals(carved)).toBe(false);
  await looks.getByRole('button', { name: 'Studio' }).click();
  await expect
    .poll(() => woodPixels(page, view), { timeout: 20_000 })
    .toBeGreaterThan(withoutStock + 20_000);
  await looks.getByRole('button', { name: 'Classic' }).click();

  await show.uncheck();
  await expect
    .poll(() => woodPixels(page, view), { timeout: 20_000 })
    .toBeLessThan(withoutStock + 2_000);
  expect(problems).toEqual([]);
});

test('a program without its bit carves with a stand-in, and says so (ADR-487)', async ({
  page,
  kerfdesk,
}) => {
  await page.goto('/');
  const dialog = await openProgram(page, kerfdesk, 'stock-no-tool.nc', pocket(false));
  await dialog.getByRole('checkbox', { name: 'Show carved stock' }).check();
  await expect(dialog.getByText(/No bit size in the file for some moves/)).toContainText(
    '3.175 mm end mill',
  );
});
