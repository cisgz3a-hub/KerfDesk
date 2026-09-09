import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Project } from '../src/core/scene';
import { TRACE_PRESETS } from '../src/core/trace/trace-presets';
import type { TraceOptions } from '../src/core/trace/trace-image';
import type { TraceWorkerRequest, TraceWorkerResponse } from '../src/ui/trace/trace-worker';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';

// Exact generated image from the reported timeout, copied without decoding or re-encoding.
const FIXTURE_NAME = 'centerline-stress-test-20260909.png';
const FIXTURE_URL = `/src/__fixtures__/perceptual/assets/${FIXTURE_NAME}`;
const FIXTURE_PATH = fileURLToPath(
  new URL(`../src/__fixtures__/perceptual/assets/${FIXTURE_NAME}`, import.meta.url),
);
const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);
const FIXTURE_SHA256 = 'e4b23a55c73c679b81889ac86a07efccd62039619b9758d63a96ca492032f846';
const COMPUTE_BUDGET_MS = 30_000; // Unchanged product watchdog; setup has a separate test budget.

interface TraceObservation {
  owner: number;
  id: number;
  options: TraceOptions;
  width: number;
  height: number;
  postedAt: number;
  startedAt: number | null;
  settledAt: number | null;
  outcome: 'ok' | 'error' | null;
  message: string | null;
  polylines: number;
  closedPolylines: number;
  vertices: number;
  geometryJson: string | null;
  ticksAtStart: number;
  ticksAtEnd: number;
}
interface WorkerObservation {
  owner: number;
  url: string;
  terminatedAt: number | null;
}
interface WorkerProbe {
  requests: TraceObservation[];
  workers: WorkerObservation[];
  ticks: number;
}
declare global {
  interface Window {
    __centerlineWorkerProbe: WorkerProbe;
  }
}
const nativeWorkers = new WeakMap<Page, { url: string; closed: boolean }[]>();

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  expect(createHash('sha256').update(FIXTURE_BYTES).digest('hex')).toBe(FIXTURE_SHA256);
  const observed: { url: string; closed: boolean }[] = [];
  nativeWorkers.set(page, observed);
  page.on('worker', (worker) => {
    if (!worker.url().includes('trace-worker')) return;
    const record = { url: worker.url(), closed: false };
    observed.push(record);
    worker.on('close', () => {
      record.closed = true;
    });
  });
  await installWorkerProbe(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while (await notifications.count()) await notifications.first().click();
});

test.afterEach(async ({ page }, testInfo) => {
  const probe = await page.evaluate(() => window.__centerlineWorkerProbe).catch(() => null);
  await testInfo.attach('centerline-worker-lifecycle.json', {
    body: JSON.stringify(
      {
        fixture: {
          name: FIXTURE_NAME,
          sha256: FIXTURE_SHA256,
          bytes: FIXTURE_BYTES.length,
          width: 1254,
          height: 1254,
        },
        nativeWorkers: nativeWorkers.get(page),
        probe,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test('default Centerline traces the actual dragon in a real worker and commits its preview', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await importDragon(page);
  await page.getByRole('button', { name: 'Trace Image...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Centerline');
  await expect(dialog.getByRole('combobox', { name: 'Trace detection' })).toHaveValue('preset');
  await expect(dialog.getByRole('spinbutton', { name: 'Remove ink specks' })).toHaveValue('12');
  await page.waitForFunction(
    () =>
      window.__centerlineWorkerProbe.requests.some(
        (r) => r.options.traceMode === 'centerline' && r.startedAt !== null,
      ),
    undefined,
    { timeout: COMPUTE_BUDGET_MS },
  );
  const remaining = await page.evaluate((budget) => {
    const request = window.__centerlineWorkerProbe.requests
      .filter((r) => r.options.traceMode === 'centerline')
      .at(-1);
    if (request?.startedAt === null || request?.startedAt === undefined)
      throw Error('No Centerline worker acknowledgement');
    return Math.max(1, budget - (performance.now() - request.startedAt));
  }, COMPUTE_BUDGET_MS);
  const preview = dialog.locator('[aria-label="Trace preview (1254x1254 px)"]');
  await expect(preview.locator('svg path').first()).toBeVisible({ timeout: remaining });
  await expect(dialog.getByText(/Preview failed:/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Show Points', exact: true })).toBeVisible();
  const request = (await observations(page))
    .filter((r) => r.options.traceMode === 'centerline')
    .at(-1);
  if (request === undefined || request.startedAt === null || request.settledAt === null)
    throw Error('Missing completed real-worker trace');
  expect(request.options).toEqual(TRACE_PRESETS.Centerline);
  expect(request.width * request.height).toBeGreaterThan(160_000);
  expect(request.outcome).toBe('ok');
  expect(request.polylines).toBeGreaterThan(0);
  expect(request.closedPolylines).toBeGreaterThan(0);
  expect(request.vertices).toBeGreaterThan(1);
  expect(request.settledAt - request.startedAt).toBeLessThan(COMPUTE_BUDGET_MS);
  expect(request.ticksAtEnd - request.ticksAtStart).toBeGreaterThan(0);
  expect(nativeWorkers.get(page)?.length).toBeGreaterThan(0);
  const svgPaths = await preview.locator('svg path').evaluateAll((paths) =>
    paths.map((path) => ({
      fill: path.getAttribute('fill'),
      stroke: path.getAttribute('stroke'),
      d: path.getAttribute('d') ?? '',
    })),
  );
  expect(
    svgPaths.every(
      (path) => path.fill === 'none' && path.stroke !== null && path.stroke !== 'none',
    ),
  ).toBe(true);
  expect(svgPaths.reduce((sum, path) => sum + (path.d.match(/\bZ\b/gi)?.length ?? 0), 0)).toBe(
    request.closedPolylines,
  );
  await dialog.screenshot({ path: testInfo.outputPath('dragon-centerline-preview.png') });
  const beforeCommit = (await observations(page)).length;
  await dialog.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  expect((await observations(page)).length).toBe(beforeCommit); // Commits the prepared preview, without tracing again.
  const project = await saveProject(page, kerfdesk);
  const traced = project.scene.objects.find(
    (object) => object.kind === 'traced-image' && object.source === FIXTURE_NAME,
  );
  if (traced?.kind !== 'traced-image')
    throw Error('The actual scene did not receive the dragon trace');
  expect(traced.traceMode).toBe('centerline');
  expect([traced.tracePixelWidth, traced.tracePixelHeight]).toEqual([1254, 1254]);
  if (request.geometryJson === null) throw Error('Missing worker output geometry');
  expect(traced.paths).toEqual(JSON.parse(request.geometryJson));
  const polylines = traced.paths.flatMap((path) => path.polylines);
  expect(polylines.length).toBe(request.polylines);
  expect(polylines.reduce((sum, line) => sum + line.points.length, 0)).toBe(request.vertices);
  expect(
    polylines.every(
      (line) =>
        line.points.length >= 2 &&
        line.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ),
  ).toBe(true);
  await testInfo.attach('dragon-committed-scene.json', {
    body: JSON.stringify({
      id: traced.id,
      traceMode: traced.traceMode,
      bounds: traced.bounds,
      grid: [traced.tracePixelWidth, traced.tracePixelHeight],
      polylines: polylines.length,
      vertices: request.vertices,
    }),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath('dragon-centerline-committed.png') });
});

test('superseding an active dragon trace terminates its real worker and completes the replacement', async ({
  page,
}) => {
  const outcome = await page.evaluate(async (fixtureUrl) => {
    const clientPath = '/src/ui/trace/use-trace-worker-client.ts';
    const loaderPath = '/src/ui/trace/image-loader.ts';
    const presetsPath = '/src/core/trace/trace-presets.ts';
    const client = (await import(
      /* @vite-ignore */ clientPath
    )) as typeof import('../src/ui/trace/use-trace-worker-client');
    const loader = (await import(
      /* @vite-ignore */ loaderPath
    )) as typeof import('../src/ui/trace/image-loader');
    const presets = (await import(
      /* @vite-ignore */ presetsPath
    )) as typeof import('../src/core/trace/trace-presets');
    const response = await fetch(fixtureUrl);
    if (!response.ok) throw Error('Dragon fixture unavailable');
    const image = await loader.loadImageAsRawData(
      new File([await response.blob()], 'dragon.png', { type: 'image/png' }),
    );
    const original = new Uint8ClampedArray(image.data);
    const options = presets.TRACE_PRESETS.Centerline;
    if (options === undefined) throw Error('Default Centerline preset missing');
    const started = new Promise<void>((resolve) =>
      window.addEventListener('centerline-worker-started', () => resolve(), { once: true }),
    );
    const obsolete = client.traceImage(image, options).then(
      () => ({ kind: 'ok' }),
      (error: unknown) => ({ kind: error instanceof Error ? error.name : String(error) }),
    );
    await Promise.race([
      started,
      obsolete.then(() => {
        throw Error('Dragon request settled before active supersession');
      }),
    ]);
    const data = new Uint8ClampedArray(32 * 32 * 4).fill(255);
    for (let y = 14; y < 18; y++)
      for (let x = 4; x < 28; x++) {
        const index = (y * 32 + x) * 4;
        data[index] = data[index + 1] = data[index + 2] = 0;
      }
    const replacement = await client.traceImage({ width: 32, height: 32, data }, options);
    return {
      obsolete: await obsolete,
      width: replacement.width,
      height: replacement.height,
      polylines: replacement.paths.flatMap((p) => p.polylines).length,
      sourceIntact: image.data.every((byte, index) => byte === original[index]),
    };
  }, FIXTURE_URL);
  expect(outcome).toMatchObject({
    obsolete: { kind: 'TraceRequestSupersededError' },
    width: 32,
    height: 32,
    sourceIntact: true,
  });
  expect(outcome.polylines).toBeGreaterThan(0);
  const requests = await observations(page);
  expect(requests).toHaveLength(2);
  const [old, current] = requests;
  if (
    old === undefined ||
    current === undefined ||
    current.startedAt === null ||
    current.settledAt === null
  )
    throw Error('Missing real-worker replacement lifecycle');
  expect(old.startedAt).not.toBeNull();
  expect(old.outcome).toBeNull();
  expect(current.owner).not.toBe(old.owner);
  expect(current.outcome).toBe('ok');
  expect(current.settledAt - current.startedAt).toBeLessThan(COMPUTE_BUDGET_MS);
  const workers = await page.evaluate(() => window.__centerlineWorkerProbe.workers);
  expect(workers.find((worker) => worker.owner === old.owner)?.terminatedAt).toEqual(
    expect.any(Number),
  );
  expect(workers.find((worker) => worker.owner === current.owner)?.terminatedAt).toBeNull();
  await expect.poll(() => nativeWorkers.get(page)?.[0]?.closed).toBe(true);
  expect(nativeWorkers.get(page)).toHaveLength(2);
});

async function importDragon(page: Page): Promise<void> {
  await page.evaluate(
    ({ name, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([bytes], name, { type: 'image/png' });
      const picker = window as Window & {
        showOpenFilePicker?: () => Promise<FileSystemFileHandle[]>;
      };
      picker.showOpenFilePicker = async () => [
        { kind: 'file', name, getFile: async () => file } as FileSystemFileHandle,
      ];
    },
    { name: FIXTURE_NAME, base64: FIXTURE_BYTES.toString('base64') },
  );
  await page.getByRole('button', { name: 'Import...', exact: true }).click();
  await expect(page.getByText('Objects: 2', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Trace Image...', exact: true })).toBeEnabled();
}

async function saveProject(page: Page, fixture: KerfDeskFixture): Promise<Project> {
  await page.getByRole('button', { name: 'Save As...', exact: true }).click();
  await expect
    .poll(async () => Object.keys(await fixture.savedFiles()).some((name) => name.endsWith('.lf2')))
    .toBe(true);
  const entry = Object.entries(await fixture.savedFiles()).find(([name]) => name.endsWith('.lf2'));
  if (entry === undefined) throw Error('Saved scene is missing');
  return JSON.parse(entry[1]) as Project;
}

function observations(page: Page): Promise<TraceObservation[]> {
  return page.evaluate(() => window.__centerlineWorkerProbe.requests);
}

async function installWorkerProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: WorkerProbe = { requests: [], workers: [], ticks: 0 };
    window.__centerlineWorkerProbe = probe;
    window.setInterval(() => {
      probe.ticks++;
    }, 25);
    // Observe an unchanged native Worker: do not fake execution, acknowledgements,
    // responses, timers or termination. Playwright independently sees each worker.
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        const url = String(args[0]);
        if (!url.includes('trace-worker')) return worker;
        const owner = probe.workers.length + 1;
        const lifetime: WorkerObservation = { owner, url, terminatedAt: null };
        probe.workers.push(lifetime);
        worker.addEventListener('message', (event: MessageEvent<TraceWorkerResponse>) => {
          const reply = event.data;
          const request = probe.requests.find((r) => r.owner === owner && r.id === reply.id);
          if (request === undefined) return;
          if (reply.kind === 'started') {
            request.startedAt = performance.now();
            request.ticksAtStart = probe.ticks;
            window.dispatchEvent(new Event('centerline-worker-started'));
          } else {
            request.settledAt = performance.now();
            request.ticksAtEnd = probe.ticks;
            request.outcome = reply.kind;
            if (reply.kind === 'error') request.message = reply.message;
            else {
              request.geometryJson = JSON.stringify(reply.paths);
              for (const path of reply.paths)
                for (const line of path.polylines) {
                  request.polylines++;
                  if (line.closed) request.closedPolylines++;
                  request.vertices += line.points.length;
                }
            }
          }
        });
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (
          message: TraceWorkerRequest,
          transfer?: Transferable[] | StructuredSerializeOptions,
        ): void => {
          probe.requests.push({
            owner,
            id: message.id,
            options: structuredClone(message.options),
            width: message.image.width,
            height: message.image.height,
            postedAt: performance.now(),
            startedAt: null,
            settledAt: null,
            outcome: null,
            message: null,
            polylines: 0,
            closedPolylines: 0,
            vertices: 0,
            geometryJson: null,
            ticksAtStart: 0,
            ticksAtEnd: 0,
          });
          if (Array.isArray(transfer)) post(message, transfer);
          else post(message, transfer);
        };
        const terminate = worker.terminate.bind(worker);
        worker.terminate = (): void => {
          lifetime.terminatedAt = performance.now();
          terminate();
        };
        return worker;
      },
    });
  });
}
