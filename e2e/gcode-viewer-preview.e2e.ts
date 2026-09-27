import { expect, test, type Page } from './fixtures/kerfdesk-test';

// 300,000 moves across rows. Read on a throttled CPU, the worker takes
// seconds, long enough to watch the picture grow.
const ROWS = 1500;
const CPU_SLOWDOWN = 6;
const STEPS_PER_ROW = 200;
const MOVES = ROWS * STEPS_PER_ROW;

function bigProgram(): string {
  const lines = ['G21 G90', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F600'];
  for (let row = 0; row < ROWS; row += 1) {
    const y = (row * 0.05).toFixed(2);
    for (let step = 1; step <= STEPS_PER_ROW; step += 1) {
      const x = ((row % 2 === 0 ? step : STEPS_PER_ROW - step) * 0.5).toFixed(1);
      lines.push(`X${x} Y${y}`);
    }
  }
  lines.push('G0 Z5');
  return lines.join('\n');
}

// Watches WebGL draws into the preview's canvas: how many moves it drew in
// all, and the most pixels its lines lit, read after each draw until plenty
// are lit (reading the canvas is slow). Reading pixels straight after a draw
// sees the frame before it is shown, so the check does not race the full
// view replacing the preview.
async function watchPreviewDraws(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Gl = WebGL2RenderingContext;
    const PLENTY = 5_000;
    const drawn = { draws: 0, moves: 0, litPixels: 0 };
    Object.assign(window, { __previewDrawn: drawn });
    const litPixels = (gl: Gl): number => {
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let lit = 0;
      for (let at = 0; at < pixels.length; at += 4) {
        const differs =
          Math.abs((pixels[at] ?? 0) - (pixels[0] ?? 0)) +
          Math.abs((pixels[at + 1] ?? 0) - (pixels[1] ?? 0)) +
          Math.abs((pixels[at + 2] ?? 0) - (pixels[2] ?? 0));
        if (differs > 24) lit += 1;
      }
      return lit;
    };
    // Everything the preview's status line said, kept as it changes.
    const said = new Set<string>();
    Object.assign(window, { __previewSaid: said });
    new MutationObserver(() => {
      for (const status of document.querySelectorAll('.gcode-viewer-preview [role="status"]')) {
        said.add(status.textContent ?? '');
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
    const proto = WebGL2RenderingContext.prototype;
    const { drawArrays } = proto;
    proto.drawArrays = function (this: Gl, mode: number, first: number, count: number) {
      drawArrays.call(this, mode, first, count);
      const canvas = this.canvas as HTMLCanvasElement;
      if (mode !== this.LINES || canvas.closest?.('.gcode-viewer-preview') == null) return;
      drawn.draws += 1;
      drawn.moves += count / 2;
      if (drawn.litPixels < PLENTY) drawn.litPixels = Math.max(drawn.litPixels, litPixels(this));
    };
  });
}

interface PreviewDrawn {
  readonly draws: number;
  readonly moves: number;
  readonly litPixels: number;
}

// What the preview's status line has said so far. Read from a record rather
// than the page, so the check does not race the full view replacing it.
async function previewSaid(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...(window as unknown as { __previewSaid: Set<string> }).__previewSaid].join('\n'),
  );
}

async function previewDrawn(page: Page): Promise<PreviewDrawn> {
  return page.evaluate(
    () => (window as unknown as { __previewDrawn: PreviewDrawn }).__previewDrawn,
  );
}

test('the Inspector draws the moves read so far while its worker reads a big file (ADR-485)', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await watchPreviewDraws(page);
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'big-preview.nc', text: bigProgram() }]);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: big-preview.nc' });
  const preview = dialog.locator('.gcode-viewer-preview');
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => previewSaid(page)).toMatch(/worker.*cancel/i);
  await expect.poll(() => previewSaid(page)).toMatch(/[\d,]+ moves read/);

  // Says how many draws there were, so a failure tells a blank canvas from none.
  await expect
    .poll(
      async () => {
        const { draws, litPixels } = await previewDrawn(page);
        return `${litPixels > 500 ? 'lit' : 'not lit'} after ${draws} draws (${litPixels} px)`;
      },
      { timeout: 30_000 },
    )
    .toMatch(/^lit/);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  await expect(dialog.getByText(/shown segments/)).toBeVisible({ timeout: 150_000 });
  await expect(preview).toHaveCount(0);
  // Each batch is drawn once over the last; only reframes redraw the lot.
  const drawn = await previewDrawn(page);
  expect(drawn.draws).toBeGreaterThan(1);
  expect(drawn.moves).toBeGreaterThan(10_000);
  expect(drawn.moves).toBeLessThan(MOVES * 4);
  expect(errors).toEqual([]);
});
