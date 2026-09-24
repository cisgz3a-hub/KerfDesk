import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TraceWorkerRequest, TraceWorkerResponse } from '../src/ui/trace/trace-worker';
import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

const portrait = readFileSync(
  fileURLToPath(new URL('../src/__fixtures__/perceptual/assets/astronaut.png', import.meta.url)),
).toString('base64');

interface PhotoRequest {
  worker: number;
  id: number;
  detail: number;
  events: string[];
  errors: string[];
}
interface PhotoSnapshot {
  completed: PhotoRequest[];
  dispatches: Pick<PhotoRequest, 'worker' | 'id' | 'detail'>[];
}
interface PointBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface PointSnapshot {
  paints: number;
  width: number;
  height: number;
  ink: boolean;
  matrix: number[];
  bounds: PointBounds;
  viewport: PointBounds;
  artwork: PointBounds;
}

declare global {
  interface Window {
    __tracerUpgradeProbe: { photoRequests: PhotoRequest[]; pointPaints: number };
  }
}

test.use({ viewport: { width: 1366, height: 768 }, trace: 'off' });

test('cached preset switching and dense point inspection work in the actual tracer dialog', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installWorkerProbe(page);
  await installPointPaintProbe(page);
  await openTraceDialog(page);
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Photo shading');
  const detail = dialog.getByRole('spinbutton', { name: 'Trace Detail', exact: true });
  await detail.fill('30');
  await detail.blur();
  await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 60000 });
  const before = await completedPhotoRequest(page);
  const photoStatus = await dialog.locator('.lf-trace-preview__status').innerText();
  const photoSvg = await previewFingerprint(dialog);
  const observations = await inspectPointViews(page, dialog);
  await dialog.screenshot({ path: testInfo.outputPath('dense-points.png') });
  await inspectCachedPhoto(page, dialog, before, photoStatus, photoSvg);
  await dialog.getByRole('button', { name: 'Show Points', exact: true }).click();
  await dialog.getByRole('button', { name: 'Show trace result', exact: true }).click();
  await dialog.getByText('Photo output tips', { exact: true }).click();
  await dialog.getByText(/Source size:/).scrollIntoViewIfNeeded();
  await expect(dialog.getByText(/Source size:/)).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Trace', exact: true })).toBeInViewport();
  await dialog.screenshot({ path: testInfo.outputPath('photo-output-controls.png') });
  const probe = await page.evaluate(() => window.__tracerUpgradeProbe);
  expect(errors).toEqual([]);
  await testInfo.attach('preview-observations.json', {
    body: JSON.stringify({ observations, probe, errors }, null, 2),
    contentType: 'application/json',
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
});

async function installWorkerProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__tracerUpgradeProbe = { photoRequests: [], pointPaints: 0 };
    let workerId = 0;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        const worker = Reflect.construct(target, args) as Worker;
        if (!String(args[0]).includes('trace-worker')) return worker;
        const owner = ++workerId;
        const requests = new Map<number, PhotoRequest>();
        worker.postMessage = new Proxy(worker.postMessage, {
          apply(post, _receiver, parameters: unknown[]) {
            const request = parameters[0] as Partial<TraceWorkerRequest>;
            const detail = request.options?.photoDetail;
            if (typeof detail === 'number' && typeof request.id === 'number') {
              const record: PhotoRequest = {
                worker: owner,
                id: request.id,
                detail,
                events: [],
                errors: [],
              };
              requests.set(request.id, record);
              window.__tracerUpgradeProbe.photoRequests.push(record);
            }
            Reflect.apply(post, worker, parameters);
          },
        });
        worker.addEventListener('message', (event: MessageEvent<TraceWorkerResponse>) => {
          const response = event.data;
          const record = requests.get(response.id);
          if (record === undefined) return;
          if (response.kind !== 'progress') record.events.push(response.kind);
          else if (response.phase !== undefined) record.events.push(response.phase);
          if (response.kind === 'error') record.errors.push(response.message);
        });
        return worker;
      },
    });
  });
}

async function installPointPaintProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    CanvasRenderingContext2D.prototype.clearRect = new Proxy(
      CanvasRenderingContext2D.prototype.clearRect,
      {
        apply(target, context: CanvasRenderingContext2D, args: [number, number, number, number]) {
          if (context.canvas.getAttribute('aria-label') === 'Trace points')
            window.__tracerUpgradeProbe.pointPaints += 1;
          Reflect.apply(target, context, args);
        },
      },
    );
  });
}

async function openTraceDialog(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate((base64) => {
    const file = new File(
      [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
      'preview-portrait.png',
      { type: 'image/png' },
    );
    Object.assign(window, {
      showOpenFilePicker: async () => [
        { kind: 'file', name: file.name, getFile: async () => file },
      ],
    });
  }, portrait);
  await (await toolbarCommand(page, 'Import...')).click();
  await (await toolbarCommand(page, 'Trace Image...')).click();
}

async function completedPhotoRequest(page: Page): Promise<PhotoSnapshot> {
  // Match one worker instance and request ID; other presets cannot supply its phases.
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__tracerUpgradeProbe.photoRequests
          .filter((r) => r.detail === 30)
          .map((r) => r.events),
      ),
    )
    .toEqual([['started', 'preparing', 'tracing', 'refining', 'ok']]);
  const snapshot = await page.evaluate(() => ({
    completed: window.__tracerUpgradeProbe.photoRequests.filter((r) => r.detail === 30),
    dispatches: window.__tracerUpgradeProbe.photoRequests.map(({ worker, id, detail }) => ({
      worker,
      id,
      detail,
    })),
  }));
  expect(snapshot.completed.map((request) => request.errors)).toEqual([[]]);
  return snapshot;
}

async function inspectPointViews(
  page: Page,
  dialog: Locator,
): Promise<Record<string, PointSnapshot>> {
  await dialog.getByRole('button', { name: 'Show Points', exact: true }).click();
  const points = dialog.locator('canvas[aria-label="Trace points"]');
  await expect(points).toHaveCount(1);
  await expect(dialog.locator('.lf-trace-preview__points circle')).toHaveCount(0);
  const initial = await expectPointPaint(points);
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom2 = await expectPointPaint(points, initial);
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom4 = await expectPointPaint(points, zoom2);
  await panPreview(dialog);
  const scrolled = await expectPointPaint(points, zoom4);
  await dialog.getByRole('button', { name: 'Show original image', exact: true }).click();
  await expect(points).toBeHidden();
  await dialog.getByRole('button', { name: 'Show overlay', exact: true }).click();
  await expect(points).toBeVisible();
  const overlay = await expectPointPaint(points, scrolled, false);
  await dialog.getByRole('button', { name: 'Fit', exact: true }).click();
  const fitted = await expectPointPaint(points, overlay);
  await page.setViewportSize({ width: 1180, height: 720 });
  const resized = await expectPointPaint(points, fitted);
  return { initial, zoom2, zoom4, scrolled, overlay, fitted, resized };
}

async function panPreview(dialog: Locator): Promise<void> {
  const movement = await dialog
    .getByRole('region', { name: 'Preview viewport' })
    .evaluate((viewport) => {
      const left = viewport.scrollLeft;
      const top = viewport.scrollTop;
      if (
        viewport.scrollWidth - viewport.clientWidth - left < 100 ||
        viewport.scrollHeight - viewport.clientHeight - top < 80
      )
        throw new Error('Zoomed preview does not have room for the requested pan');
      viewport.scrollLeft += 100;
      viewport.scrollTop += 80;
      return { x: viewport.scrollLeft - left, y: viewport.scrollTop - top };
    });
  expect(movement).toEqual({ x: 100, y: 80 });
}

async function inspectCachedPhoto(
  page: Page,
  dialog: Locator,
  before: PhotoSnapshot,
  photoStatus: string,
  photoSvg: string,
): Promise<void> {
  const preset = dialog.getByRole('combobox', { name: 'Trace preset' });
  await preset.selectOption('Sharp');
  await expect(dialog.getByText(/Trace ready/)).toBeVisible({ timeout: 60000 });
  await preset.selectOption('Photo shading');
  await expect(dialog.getByRole('spinbutton', { name: 'Trace Detail', exact: true })).toHaveValue(
    '30',
  );
  await expect(dialog.locator('.lf-trace-preview__status')).toHaveText(photoStatus, {
    useInnerText: true,
  });
  expect(await completedPhotoRequest(page)).toEqual(before);
  expect(await previewFingerprint(dialog)).toBe(photoSvg);
  await expect(dialog.getByRole('spinbutton', { name: 'Trace Midtones', exact: true })).toHaveValue(
    '1',
  );
}

async function previewFingerprint(dialog: Locator): Promise<string> {
  return dialog.locator('.lf-trace-preview__vectors > svg').evaluate(async (svg) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(svg.outerHTML));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  });
}

async function expectPointPaint(
  points: Locator,
  previous?: PointSnapshot,
  transformChanged = true,
): Promise<PointSnapshot> {
  let snapshot: PointSnapshot | undefined;
  await expect(async () => {
    snapshot = await points.evaluate(readPointSnapshot);
    expect(snapshot.ink).toBe(true);
    expect(snapshot.width * snapshot.height).toBeLessThanOrEqual(4194304);
    expect(Math.max(snapshot.width, snapshot.height)).toBeLessThanOrEqual(4096);
    expect(snapshot.paints).toBeGreaterThan(previous?.paints ?? 0);
    if (previous !== undefined && transformChanged)
      expect(snapshot.matrix).not.toEqual(previous.matrix);
    const { bounds, viewport, artwork } = snapshot;
    expect(bounds.right - bounds.left).toBeGreaterThan(1);
    expect(bounds.bottom - bounds.top).toBeGreaterThan(1);
    // The bitmap stays inside the viewport and covers every visible artwork pixel.
    expect(bounds.left).toBeGreaterThanOrEqual(viewport.left - 1);
    expect(bounds.top).toBeGreaterThanOrEqual(viewport.top - 1);
    expect(bounds.right).toBeLessThanOrEqual(viewport.right + 1);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom + 1);
    expect(bounds.left).toBeLessThanOrEqual(Math.max(viewport.left, artwork.left) + 1);
    expect(bounds.top).toBeLessThanOrEqual(Math.max(viewport.top, artwork.top) + 1);
    expect(bounds.right).toBeGreaterThanOrEqual(Math.min(viewport.right, artwork.right) - 1);
    expect(bounds.bottom).toBeGreaterThanOrEqual(Math.min(viewport.bottom, artwork.bottom) - 1);
  }).toPass({ timeout: 10000 });
  if (snapshot === undefined) throw new Error('Point overlay did not paint');
  return snapshot;
}

function readPointSnapshot(canvas: HTMLCanvasElement): PointSnapshot {
  const context = canvas.getContext('2d');
  const viewport = canvas.closest<HTMLElement>('.lf-trace-preview__viewport');
  const artwork = canvas.parentElement;
  if (context === null || viewport === null || artwork === null)
    throw new Error('Missing point overlay context or frame');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const bounds = canvas.getBoundingClientRect();
  const art = artwork.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  const left = frame.left + viewport.clientLeft;
  const top = frame.top + viewport.clientTop;
  return {
    paints: window.__tracerUpgradeProbe.pointPaints,
    width: canvas.width,
    height: canvas.height,
    ink: pixels.some((value, index) => index % 4 === 3 && value !== 0),
    matrix: Array.from(context.getTransform().toFloat64Array()),
    bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
    viewport: {
      left,
      top,
      right: left + viewport.clientWidth,
      bottom: top + viewport.clientHeight,
    },
    artwork: { left: art.left, top: art.top, right: art.right, bottom: art.bottom },
  };
}
