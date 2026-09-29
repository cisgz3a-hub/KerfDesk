import {
  expect,
  test,
  type KerfDeskFixture,
  type Locator,
  type Page,
} from './fixtures/kerfdesk-test';

// Two 20 mm squares filled with lines 0.1 mm apart: the left at full power,
// the right at 30%. Laser moves at one height, as a laser program is.
function squares(): string {
  const lines = ['G21 G90', 'M4 S0', 'G0 X0 Y0'];
  for (const [left, power] of [
    [0, 1000],
    [30, 300],
  ] as const) {
    for (let row = 0; row <= 200; row += 1) {
      const y = (row * 0.1).toFixed(1);
      lines.push(`G0 X${left} Y${y}`, `G1 X${left + 20} Y${y} S${power} F3000`);
    }
  }
  lines.push('M5', 'G0 X0 Y0');
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
  // A still camera, so pictures taken at the same place in the program match.
  await dialog
    .getByRole('group', { name: 'Camera mode' })
    .getByRole('button', { name: 'Manual' })
    .click();
  return dialog;
}

// Pixels of the view in bare wood's warm colours, or pale as a laminate's
// white core, read from a screenshot.
async function countPixels(page: Page, view: Locator, kind: 'wood' | 'pale'): Promise<number> {
  const png = (await view.screenshot()).toString('base64');
  return page.evaluate(
    async ({ data, kind }) => {
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
      let count = 0;
      for (let at = 0; at < pixels.length; at += 4) {
        const [red, green, blue] = [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0];
        const wood = red > 90 && red >= green && green - blue > 15 && red - blue > 35;
        const pale = red > 170 && green > 170 && blue > 160;
        if (kind === 'wood' ? wood : pale) count += 1;
      }
      return count;
    },
    { data: png, kind },
  );
}

function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  return problems;
}

test('the Inspector burns a laser program onto its sheet as playback runs (ADR-487, ADR-501)', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.goto('/');
  const dialog = await openProgram(page, kerfdesk, 'burn-squares.nc', squares());
  const view = dialog.getByLabel('3D G-code toolpath', { exact: true });
  const show = dialog.getByRole('checkbox', { name: 'Show burn preview' });
  // A laser program has a burn, not a stock.
  await expect(dialog.getByRole('checkbox', { name: 'Show carved stock' })).toHaveCount(0);
  await expect(show).not.toBeChecked();
  const without = await countPixels(page, view, 'wood');

  // At the start the sheet is bare wood.
  await show.check();
  await view.focus();
  await page.keyboard.press('Home');
  await expect
    .poll(() => countPixels(page, view, 'wood'), { timeout: 30_000 })
    .toBeGreaterThan(without + 20_000);
  const bare = await countPixels(page, view, 'wood');
  // It shades by energy (ADR-501): the default machine states no laser power,
  // so 10 W is taken; S1000 at 3000 mm/min on a 0.1 mm beam is 2 J/mm², S300 0.6.
  await expect(dialog.getByText(/this program puts in 0\.6 J\/mm² to 2 J\/mm²/)).toBeVisible();
  await expect(dialog.getByText(/10 W \(taken/)).toBeVisible();

  // At the end the full-power square is charred and no longer wood; the 30%
  // square is only scorched, still a wood brown.
  await page.keyboard.press('End');
  await expect
    .poll(() => countPixels(page, view, 'wood'), { timeout: 30_000 })
    .toBeLessThan(bare - 5_000);
  const burned = await countPixels(page, view, 'wood');
  expect(burned).toBeGreaterThan(without + 10_000);

  // The laminate loses its black cap where it burns and shows its white core.
  const material = dialog.getByLabel('Burn material');
  await expect(material).toHaveValue('wood');
  await material.selectOption('laminate');
  await page.keyboard.press('Home');
  await expect
    .poll(() => countPixels(page, view, 'wood'), { timeout: 20_000 })
    .toBeLessThan(without + 2_000);
  const capped = await countPixels(page, view, 'pale');
  await page.keyboard.press('End');
  await expect
    .poll(() => countPixels(page, view, 'pale'), { timeout: 30_000 })
    .toBeGreaterThan(capped + 5_000);
  await material.selectOption('wood');

  // Power only is LightBurn's shading, as ADR-487 drew it.
  const shadeBy = dialog.getByLabel('Shade the burn by');
  await shadeBy.selectOption('power');
  await expect(dialog.getByText(/S 1000 darkest/)).toBeVisible();
  await view.focus();
  await page.keyboard.press('End');
  await expect
    .poll(() => countPixels(page, view, 'wood'), { timeout: 30_000 })
    .toBeGreaterThan(without + 10_000);
  await shadeBy.selectOption('energy');

  await show.uncheck();
  await expect
    .poll(() => countPixels(page, view, 'wood'), { timeout: 20_000 })
    .toBeLessThan(without + 2_000);
  expect(problems).toEqual([]);
});

test('on a rotary the burn wraps round the work (ADR-487)', async ({ page, kerfdesk }) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.goto('/');
  await expect(page.getByRole('menubar', { name: 'Application menu' })).toBeVisible();
  // A chuck rotary turning 40 mm work once in 100 mm of Y.
  await page.evaluate(async () => {
    const statePath = '/src/ui/state/store.ts';
    const { useStore } = (await import(statePath)) as {
      useStore: {
        getState: () => { project: { device: object } };
        setState: (patch: object) => void;
      };
    };
    const { project } = useStore.getState();
    const rotary = { enabled: true, type: 'chuck', mmPerRotation: 100, objectDiameterMm: 40 };
    useStore.setState({ project: { ...project, device: { ...project.device, rotary } } });
  });
  const dialog = await openProgram(page, kerfdesk, 'burn-rotary.nc', squares());
  const view = dialog.getByLabel('3D G-code toolpath', { exact: true });
  await dialog.getByRole('checkbox', { name: 'Show burn preview' }).check();
  const wrap = dialog.getByRole('checkbox', { name: /Wrap round the rotary \(⌀ 40 mm\)/ });
  await expect(wrap).toBeChecked();
  await expect
    .poll(() => countPixels(page, view, 'wood'), { timeout: 30_000 })
    .toBeGreaterThan(10_000);
  const round = await view.screenshot();
  const roundWood = await countPixels(page, view, 'wood');
  // Unwrapped, the same burn lies flat: a different picture, less wood.
  await wrap.uncheck();
  await expect.poll(async () => (await view.screenshot()).equals(round)).toBe(false);
  await expect.poll(() => countPixels(page, view, 'wood'), { timeout: 20_000 }).not.toBe(roundWood);
  expect(problems).toEqual([]);
});
