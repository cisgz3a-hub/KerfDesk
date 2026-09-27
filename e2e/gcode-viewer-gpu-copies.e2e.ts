import { expect, test, type Page } from './fixtures/kerfdesk-test';

// A 20,000-move serpentine at one depth: enough moves that a second GPU copy
// of them would show plainly in the buffer total.
const ROWS = 100;
const STEPS_PER_ROW = 200;

function serpentine(): string {
  const lines = ['G21 G90', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F600'];
  for (let row = 0; row < ROWS; row += 1) {
    for (let step = 1; step <= STEPS_PER_ROW; step += 1) {
      const x = ((row % 2 === 0 ? step : STEPS_PER_ROW - step) * 0.5).toFixed(2);
      lines.push(`G1 X${x} Y${(row * 0.5).toFixed(2)} F${900 + (step % 7) * 100}`);
    }
  }
  lines.push('G0 Z5');
  return lines.join('\n');
}

// A few kilobytes for the rapids' own pick copy and the hover outline.
const SMALL_BYTES = 64 * 1024;

// Counts the bytes held in WebGL buffers, so the test sees what the view
// keeps on the GPU rather than what it meant to.
async function trackGpuBuffers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Gl = WebGL2RenderingContext;
    const proto = WebGL2RenderingContext.prototype;
    const sizes = new WeakMap<WebGLBuffer, number>();
    const bound = new Map<number, WebGLBuffer | null>();
    const total = { bytes: 0 };
    Object.assign(window, { __gpuBufferBytes: () => total.bytes });
    const { bindBuffer, bufferData, deleteBuffer } = proto;
    proto.bindBuffer = function (this: Gl, target: number, buffer: WebGLBuffer | null) {
      bound.set(target, buffer);
      bindBuffer.call(this, target, buffer);
    };
    proto.bufferData = function (this: Gl, target: number, ...rest: unknown[]) {
      const source = rest[0] as number | ArrayBufferView | null;
      const buffer = bound.get(target);
      const size = typeof source === 'number' ? source : (source?.byteLength ?? 0);
      if (buffer) {
        total.bytes += size - (sizes.get(buffer) ?? 0);
        sizes.set(buffer, size);
      }
      (bufferData as (...args: unknown[]) => void).call(this, target, ...rest);
    } as Gl['bufferData'];
    proto.deleteBuffer = function (this: Gl, buffer: WebGLBuffer | null) {
      if (buffer) {
        total.bytes -= sizes.get(buffer) ?? 0;
        sizes.delete(buffer);
      }
      deleteBuffer.call(this, buffer);
    };
  });
}

test('the 3D view keeps one GPU copy of the moves through pick, lens and playback (ADR-485)', async ({
  page,
  kerfdesk,
}) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await trackGpuBuffers(page);
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'gpu-serpentine.nc', text: serpentine() }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: 'G-code Inspector: gpu-serpentine.nc' });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 30_000 });
  const gpuBytes = (): Promise<number> =>
    page.evaluate(() =>
      (window as unknown as { __gpuBufferBytes: () => number }).__gpuBufferBytes(),
    );
  const settle = (): Promise<void> => page.waitForTimeout(600);
  await settle();
  const opened = await gpuBytes();
  // Twenty thousand moves at 24 bytes of positions each, at least.
  expect(opened).toBeGreaterThan(ROWS * STEPS_PER_ROW * 24);

  // Pointing at a move builds the pick pass over the drawn lines' buffers.
  const view = dialog.getByLabel('3D G-code toolpath', { exact: true });
  const box = await view.boundingBox();
  if (box === null) throw new Error('view has no size');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await settle();
  await page.mouse.move(box.x + box.width / 2 + 9, box.y + box.height / 2 + 5);
  await settle();
  const picked = await gpuBytes();
  expect(picked - opened).toBeLessThan(SMALL_BYTES);

  // A lens repaints the colours in place: no new buffer, nothing left behind.
  await page.mouse.move(2, 2);
  for (const lens of ['feed', 'kind', 'depth', 'feed']) {
    await dialog.getByLabel('Colour lens').selectOption(lens);
    await settle();
  }
  expect(await gpuBytes()).toBe(picked);

  // Playback shows the faint copy of every move from the same buffers.
  const slider = dialog.getByLabel('Program time');
  const track = await slider.boundingBox();
  if (track === null) throw new Error('timeline has no size');
  await page.mouse.click(track.x + track.width * 0.5, track.y + track.height / 2);
  await settle();
  expect((await gpuBytes()) - opened).toBeLessThan(SMALL_BYTES);
  expect(problems).toEqual([]);
});
