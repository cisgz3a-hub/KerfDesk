// TEMPORARY diagnostic for PR #1242 — not for merge. Reports where the
// Inspector's "back at the start" picture differs from the first one.
import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';

function pocket(): string {
  const lines = [
    'G21 G90',
    '; cnc tool: end-mill; diameter-mm: 6',
    'G0 Z5',
    'G0 X3 Y3',
    'G1 Z-3 F300',
  ];
  for (let row = 0; row <= 8; row += 1) {
    const y = (3 + row * 3).toFixed(1);
    lines.push(`G1 X${row % 2 === 0 ? 27 : 3} Y${y} F900`);
    if (row < 8) lines.push(`G1 Y${(3 + (row + 1) * 3).toFixed(1)}`);
  }
  lines.push('G0 Z5');
  return lines.join('\n');
}

async function geometry(view: Locator): Promise<string> {
  return view.evaluate((element) => {
    const r = element.getBoundingClientRect();
    const canvas = element.querySelector('canvas');
    const c = canvas?.getBoundingClientRect();
    return JSON.stringify({
      view: [r.x, r.y, r.width, r.height],
      canvasCss: c ? [c.x, c.y, c.width, c.height] : null,
      canvasBuffer: canvas ? [canvas.width, canvas.height] : null,
      dpr: window.devicePixelRatio,
    });
  });
}

async function diff(page: Page, a: Buffer, b: Buffer): Promise<string> {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async (data: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('no 2d context');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height)
        return `size ${x.width}x${x.height} vs ${y.width}x${y.height}`;
      let count = 0;
      let max = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.max(
          Math.abs((x.data[i] ?? 0) - (y.data[i] ?? 0)),
          Math.abs((x.data[i + 1] ?? 0) - (y.data[i + 1] ?? 0)),
          Math.abs((x.data[i + 2] ?? 0) - (y.data[i + 2] ?? 0)),
        );
        if (d === 0) continue;
        count += 1;
        max = Math.max(max, d);
        const p = i / 4;
        const px = p % x.width;
        const py = Math.floor(p / x.width);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
      return `${x.width}x${x.height}: ${count} px differ, max channel delta ${max}, box x${minX}-${maxX} y${minY}-${maxY}`;
    },
    { a: a.toString('base64'), b: b.toString('base64') },
  );
}

async function settled(view: Locator): Promise<Buffer> {
  let last = await view.screenshot();
  for (let i = 0; i < 40; i += 1) {
    const next = await view.screenshot();
    if (next.equals(last)) return next;
    last = next;
  }
  return last;
}

test('DIAG Inspector stock picture after Home', async ({ page, kerfdesk }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'stock-pocket.nc', text: pocket() }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: stock-pocket.nc' });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 30_000 });
  const view = dialog.getByLabel('3D G-code toolpath', { exact: true });
  await dialog
    .getByRole('group', { name: 'Camera mode' })
    .getByRole('button', { name: 'Manual' })
    .click();
  const g0 = await geometry(view);
  await dialog.getByRole('checkbox', { name: 'Show carved stock' }).check();
  await view.focus();
  await page.keyboard.press('Home');
  await page.waitForTimeout(3000);
  const uncut = await settled(view);
  const g1 = await geometry(view);
  await page.keyboard.press('End');
  await page.waitForTimeout(3000);
  await settled(view);
  const g2 = await geometry(view);
  await page.keyboard.press('Home');
  await page.waitForTimeout(3000);
  const back = await settled(view);
  const g3 = await geometry(view);
  await test.info().attach('uncut.png', { body: uncut, contentType: 'image/png' });
  await test.info().attach('back.png', { body: back, contentType: 'image/png' });
  const report = [
    `g0 ${g0}`,
    `g1 ${g1}`,
    `g2 ${g2}`,
    `g3 ${g3}`,
    `diff ${await diff(page, uncut, back)}`,
  ].join('\n');
  expect(report).toBe('DIAG');
});
