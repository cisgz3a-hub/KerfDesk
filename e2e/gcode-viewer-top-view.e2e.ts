import { expect, test } from './fixtures/kerfdesk-test';

// A pocket 20 mm across cleared 1 mm deep, then its lower half 2 mm deep,
// with rapids between the passes.
function pocket(): string {
  const lines = ['G21 G90', 'G0 Z5'];
  for (const [depth, rows] of [
    [-1, 40],
    [-2, 20],
  ] as const) {
    lines.push('G0 X0 Y0', `G1 Z${depth} F300`);
    for (let row = 0; row < rows; row += 1) {
      const y = (row * 0.5).toFixed(2);
      lines.push(`G1 X${row % 2 === 0 ? 20 : 0} Y${y} F900`, `G1 Y${((row + 1) * 0.5).toFixed(2)}`);
    }
    lines.push('G0 Z5');
  }
  return lines.join('\n');
}

test('without 3D graphics the Inspector shows the moves from above (ADR-485)', async ({
  page,
  kerfdesk,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // A browser, or a program, the GPU cannot draw: every WebGL context fails.
  await page.addInitScript(() => {
    const { getContext } = HTMLCanvasElement.prototype;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type.startsWith('webgl')) return null;
      return (getContext as (...args: unknown[]) => RenderingContext | null).call(
        this,
        type,
        ...rest,
      );
    } as HTMLCanvasElement['getContext'];
  });
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'top-pocket.nc', text: pocket() }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: top-pocket.nc' });
  await expect(dialog.locator('[data-viewer-state="no-webgl"]')).toBeVisible({ timeout: 30_000 });
  await expect(
    dialog.getByText(/^3D view unavailable: .+ Showing the moves from above/),
  ).toContainText('where moves cross, the deepest shows. The program parsed');

  const image = dialog.getByRole('img', { name: 'G-code toolpath from above' });
  await expect(image).toBeVisible();
  const colours = (): Promise<{ pixels: number; shades: string[] }> =>
    image.evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d');
      if (context === null) return { pixels: 0, shades: [] };
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const background = `${data[0]},${data[1]},${data[2]}`;
      const shades = new Set<string>();
      let pixels = 0;
      for (let at = 0; at < data.length; at += 4) {
        const colour = `${data[at]},${data[at + 1]},${data[at + 2]}`;
        if (colour === background) continue;
        pixels += 1;
        shades.add(colour);
      }
      return { pixels, shades: [...shades].sort() };
    });
  // The cleared square fills a good part of the view, in the depth lens's
  // two colours: the lower half was cut deeper.
  const byDepth = await colours();
  expect(byDepth.pixels).toBeGreaterThan(5_000);
  expect(byDepth.shades.length).toBeGreaterThan(1);

  // Another lens repaints the same moves in its colours.
  await dialog.getByLabel('Colour lens').selectOption('kind');
  await expect.poll(async () => (await colours()).shades).not.toEqual(byDepth.shades);
  expect((await colours()).pixels).toBe(byDepth.pixels);
  // The readouts still work from the parsed program.
  await expect(dialog.getByLabel('Program time')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
