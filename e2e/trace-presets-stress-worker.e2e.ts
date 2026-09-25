import { toolbarCommand } from './fixtures/workspace-ui';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ColoredPath, Project } from '../src/core/scene';
import { traceCommitFidelity } from '../src/__fixtures__/trace-commit-fidelity';
import { TRACE_PRESETS } from '../src/core/trace/trace-presets';
import type { TraceOptions } from '../src/core/trace/trace-image';
import type { TraceWorkerRequest, TraceWorkerResponse } from '../src/ui/trace/trace-worker';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { checkWorkspaceHover } from './fixtures/workspace-responsiveness';

// Exact generated image from the reported timeout, copied without decoding or re-encoding.
const FIXTURE_NAME = 'centerline-stress-test-20260909.png';
const FIXTURE_URL = `/src/__fixtures__/perceptual/assets/${FIXTURE_NAME}`;
const FIXTURE_PATH = fileURLToPath(
  new URL(`../src/__fixtures__/perceptual/assets/${FIXTURE_NAME}`, import.meta.url),
);
const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);
const FIXTURE_SHA256 = 'e4b23a55c73c679b81889ac86a07efccd62039619b9758d63a96ca492032f846';
// ADR-336 permits long work while the native worker keeps reporting progress.
// CI's Sharp worker completed in 29.45 s with 103 heartbeats, then hit the old
// 30 s compute-plus-render assertion. Check silence separately from completion
// and rendering; the whole browser case still has a finite deadline.
const WORKER_SILENCE_MS = 30_000;
// The same trace took 157.5 s on the loaded Windows test host, with 480 beats.
const TRACE_COMPLETION_MS = 180_000;
// Mirrors HEARTBEAT_INTERVAL_MS in src/ui/trace/trace-worker.ts.
const HEARTBEAT_INTERVAL_MS = 250;

interface TraceObservation {
  owner: number;
  id: number;
  options: TraceOptions;
  width: number;
  height: number;
  postedAt: number;
  startedAt: number | null;
  settledAt: number | null;
  lastMessageAt: number;
  longestSilenceMs: number;
  outcome: 'ok' | 'error' | null;
  // Heartbeats seen while this request computed. They prove the worker stayed
  // audible without ending the request, which is what keeps a long trace's
  // silence budget alive (ADR-336).
  beats: number;
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
interface NativeWorkerObservation {
  url: string;
  closed: boolean;
}
const nativeWorkers = new WeakMap<Page, NativeWorkerObservation[]>();

test.beforeEach(async ({ page }) => {
  test.setTimeout(240_000);
  expect(createHash('sha256').update(FIXTURE_BYTES).digest('hex')).toBe(FIXTURE_SHA256);
  const observed: NativeWorkerObservation[] = [];
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

test.afterEach(async ({ page, kerfdesk }, testInfo) => {
  // Geometry is compared in the test. Do not copy its tens of MB into every
  // lifecycle attachment as well, especially when diagnosing a timeout.
  const probe = await page
    .evaluate(() => {
      const current = window.__centerlineWorkerProbe;
      return {
        ...current,
        requests: current.requests.map(({ geometryJson, ...request }) => ({
          ...request,
          geometryBytes: geometryJson?.length ?? 0,
        })),
      };
    })
    .catch(() => null);
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
  await testInfo.attach('browser-file-events.json', {
    body: JSON.stringify(await kerfdesk.events().catch(() => [])),
    contentType: 'application/json',
  });
});

for (const presetName of ['Centerline', 'Line Art', 'Smooth', 'Sharp', 'Edge Detection']) {
  test(`default ${presetName} traces the actual dragon in a real worker and commits its preview`, async ({
    page,
    kerfdesk,
  }, testInfo) => {
    await importDragon(page);
    await page.getByRole('button', { name: 'Trace Image...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Trace image' });
    const preset = TRACE_PRESETS[presetName];
    if (preset === undefined) throw Error(`Missing ${presetName} preset`);
    await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption(presetName);
    if (preset.traceMode !== 'edge') {
      await expect(dialog.getByRole('combobox', { name: 'Trace detection' })).toHaveValue('preset');
      await expect(dialog.getByRole('spinbutton', { name: 'Remove ink specks' })).toHaveValue(
        String(preset.despeckleMinPixels),
      );
    }
    await page.waitForFunction(
      (options) =>
        window.__centerlineWorkerProbe.requests.some(
          (r) => JSON.stringify(r.options) === JSON.stringify(options) && r.startedAt !== null,
        ),
      preset,
      { timeout: WORKER_SILENCE_MS },
    );
    await waitForHealthyTrace(page, preset);
    const preview = dialog.locator('[aria-label="Trace preview (1254x1254 px)"]');
    await expect(preview.locator('svg path').first()).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/Preview failed:/)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Show Points', exact: true })).toBeVisible();
    const request = (await observations(page))
      .filter((r) => JSON.stringify(r.options) === JSON.stringify(preset))
      .at(-1);
    if (request === undefined || request.startedAt === null || request.settledAt === null)
      throw Error('Missing completed real-worker trace');
    expect(request.options).toEqual(preset);
    expect(request.width * request.height).toBeGreaterThan(160_000);
    expect(request.outcome).toBe('ok');
    expect(request.polylines).toBeGreaterThan(0);
    expect(request.closedPolylines).toBeGreaterThan(0);
    expect(request.vertices).toBeGreaterThan(1);
    expect(request.longestSilenceMs).toBeLessThan(WORKER_SILENCE_MS);
    // The real worker heartbeats from inside the trace, and only from there:
    // never faster than the interval, and audible at all once the trace has
    // run longer than one. This is what keeps its silence budget alive.
    const computeMs = request.settledAt - request.startedAt;
    await testInfo.attach('dragon-trace-timing.json', {
      body: JSON.stringify({
        presetName,
        computeMs,
        longestSilenceMs: request.longestSilenceMs,
        beats: request.beats,
        polylines: request.polylines,
        vertices: request.vertices,
      }),
      contentType: 'application/json',
    });
    expect(request.beats).toBeLessThanOrEqual(Math.ceil(computeMs / HEARTBEAT_INTERVAL_MS) + 1);
    if (computeMs > 4 * HEARTBEAT_INTERVAL_MS) expect(request.beats).toBeGreaterThan(0);
    expect(request.ticksAtEnd - request.ticksAtStart).toBeGreaterThan(0);
    expect(nativeWorkers.get(page)?.length).toBeGreaterThan(0);
    const svgPaths = await preview.locator('svg path').evaluateAll((paths) =>
      paths.map((path) => ({
        fill: path.getAttribute('fill'),
        stroke: path.getAttribute('stroke'),
        d: path.getAttribute('d') ?? '',
      })),
    );
    if (preset.traceMode === 'centerline') {
      expect(
        svgPaths.every(
          (path) => path.fill === 'none' && path.stroke !== null && path.stroke !== 'none',
        ),
      ).toBe(true);
    } else {
      expect(request.closedPolylines).toBe(request.polylines);
      expect(svgPaths.every((path) => path.fill === '#000000' && path.stroke === 'none')).toBe(
        true,
      );
      await expect(preview.locator('svg path').first()).toHaveAttribute('fill-rule', 'evenodd');
    }
    expect(svgPaths.reduce((sum, path) => sum + (path.d.match(/\bZ\b/gi)?.length ?? 0), 0)).toBe(
      request.closedPolylines,
    );
    await dialog.screenshot({ path: testInfo.outputPath('dragon-preset-preview.png') });
    const beforeCommit = await page.evaluate(() => window.__centerlineWorkerProbe.requests.length);
    await dialog.getByRole('button', { name: 'Trace', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => window.__centerlineWorkerProbe.requests.length)).toBe(
      beforeCommit,
    ); // Commits the prepared preview, without tracing again.
    const project = await saveProject(page, kerfdesk);
    const traced = project.scene.objects.find(
      (object) => object.kind === 'traced-image' && object.source === FIXTURE_NAME,
    );
    if (traced?.kind !== 'traced-image')
      throw Error('The actual scene did not receive the dragon trace');
    expect(traced.traceMode).toBe(preset.traceMode ?? 'filled-contours');
    expect([traced.tracePixelWidth, traced.tracePixelHeight]).toEqual([1254, 1254]);
    if (request.geometryJson === null) throw Error('Missing worker output geometry');
    // ADR-391 conditions laser traces at commit: retaining all sample vertices
    // is no longer the contract. Independently check the saved physical fidelity,
    // contours and canonical curves without rerunning the production conditioner.
    const fidelity = traceCommitFidelity(
      JSON.parse(request.geometryJson) as ColoredPath[],
      traced.paths,
      traced.transform,
    );
    await testInfo.attach('dragon-commit-fidelity.json', {
      body: JSON.stringify({
        ...fidelity,
        workerGeometrySha256: createHash('sha256').update(request.geometryJson).digest('hex'),
        savedGeometrySha256: createHash('sha256')
          .update(JSON.stringify(traced.paths))
          .digest('hex'),
      }),
      contentType: 'application/json',
    });
    if (fidelity.issues.length > 0) {
      // Keep full diagnostics in artifacts, never in a multi-megabyte assertion
      // diff that can stall the GitHub reporter and its issue matchers.
      writeFileSync(testInfo.outputPath('worker-geometry.json'), request.geometryJson);
      writeFileSync(testInfo.outputPath('committed-project.json'), JSON.stringify(project));
    }
    expect(fidelity.issues).toEqual([]);
    const polylines = traced.paths.flatMap((path) => path.polylines);
    expect(polylines.length).toBe(request.polylines);
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
        vertices: fidelity.committedVertices,
        workerVertices: request.vertices,
      }),
      contentType: 'application/json',
    });
    await page.screenshot({ path: testInfo.outputPath('dragon-preset-committed.png') });
    const hover = await checkWorkspaceHover(page);
    await testInfo.attach('dragon-workspace-hover.json', {
      body: JSON.stringify(hover),
      contentType: 'application/json',
    });
  });
}

test('cancels an actively tracing Sharp dragon from the dialog without committing it', async ({
  page,
  kerfdesk,
}) => {
  await importDragon(page);
  await page.getByRole('button', { name: 'Trace Image...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Sharp');
  await page.waitForFunction(
    (options) =>
      window.__centerlineWorkerProbe.requests.some(
        (r) =>
          JSON.stringify(r.options) === JSON.stringify(options) &&
          r.beats > 0 &&
          r.settledAt === null,
      ),
    TRACE_PRESETS.Sharp,
    { timeout: WORKER_SILENCE_MS },
  );
  const active = (await observations(page)).at(-1);
  if (active === undefined) throw Error('Missing active Sharp trace');
  const activeNativeWorker = await captureActiveNativeWorker(page, active.owner);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 5_000 });
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  await expect
    .poll(() =>
      page.evaluate(
        (owner) =>
          window.__centerlineWorkerProbe.workers.find((worker) => worker.owner === owner)
            ?.terminatedAt,
        active.owner,
      ),
    )
    .toEqual(expect.any(Number));
  await expect.poll(() => activeNativeWorker.closed).toBe(true);
  await expect
    .poll(() => nativeWorkers.get(page)?.filter((worker) => !worker.closed).length)
    .toBe(0);
  const project = await saveProject(page, kerfdesk);
  expect(project.scene.objects).toHaveLength(2);
  expect(project.scene.objects.some((object) => object.kind === 'traced-image')).toBe(false);
  expect(
    (await observations(page)).find(
      (request) => request.owner === active.owner && request.id === active.id,
    )?.outcome,
  ).toBeNull();
});

test('superseding an active dragon trace terminates its real worker and completes the replacement', async ({
  page,
}) => {
  const replacement = await page.evaluateHandle(async (fixtureUrl) => {
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
    // Let Playwright observe the running worker before superseding it. A worker
    // terminated during startup may never produce a browser worker event.
    return async () => {
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
    };
  }, FIXTURE_URL);
  await page.waitForFunction(
    () =>
      window.__centerlineWorkerProbe.requests.some(
        (request) => request.beats > 0 && request.settledAt === null,
      ),
    undefined,
    { timeout: WORKER_SILENCE_MS },
  );
  const active = (await observations(page)).at(-1);
  if (active === undefined) throw Error('Missing active dragon trace');
  const activeNativeWorker = await captureActiveNativeWorker(page, active.owner);
  const outcome = await replacement.evaluate((runReplacement) => runReplacement());
  await replacement.dispose();
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
  expect(current.longestSilenceMs).toBeLessThan(WORKER_SILENCE_MS);
  const workers = await page.evaluate(() => window.__centerlineWorkerProbe.workers);
  expect(workers.find((worker) => worker.owner === old.owner)?.terminatedAt).toEqual(
    expect.any(Number),
  );
  expect(workers.find((worker) => worker.owner === current.owner)?.terminatedAt).toBeNull();
  await expect.poll(() => activeNativeWorker.closed).toBe(true);
  await expect
    .poll(() => nativeWorkers.get(page)?.filter((worker) => !worker.closed).length)
    .toBe(1);
  expect(nativeWorkers.get(page)?.find((worker) => !worker.closed)).not.toBe(activeNativeWorker);
  expect(nativeWorkers.get(page)).toHaveLength(2);
});

async function captureActiveNativeWorker(
  page: Page,
  owner: number,
): Promise<NativeWorkerObservation> {
  // Constructor ordinals include workers retired before Playwright reports
  // them. Capture the sole observed open instance at the active-request barrier;
  // owner-specific termination remains a separate assertion in the page probe.
  await expect
    .poll(() => nativeWorkers.get(page)?.filter((worker) => !worker.closed).length)
    .toBe(1);
  const worker = nativeWorkers.get(page)?.find((candidate) => !candidate.closed);
  if (worker === undefined) throw Error('Missing browser-observed active trace worker');
  expect(
    await page.evaluate((expectedOwner) => {
      const probe = window.__centerlineWorkerProbe;
      return {
        openOwners: probe.workers
          .filter((candidate) => candidate.terminatedAt === null)
          .map((candidate) => candidate.owner),
        activelyTracing: probe.requests.some(
          (request) =>
            request.owner === expectedOwner && request.beats > 0 && request.settledAt === null,
        ),
      };
    }, owner),
  ).toEqual({ openOwners: [owner], activelyTracing: true });
  expect(worker.closed).toBe(false);
  return worker;
}

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
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByText('Objects: 2', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Trace Image...', exact: true })).toBeEnabled();
}

async function saveProject(page: Page, fixture: KerfDeskFixture): Promise<Project> {
  await (await toolbarCommand(page, 'Save As...')).click();
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

async function waitForHealthyTrace(page: Page, options: TraceOptions): Promise<void> {
  await page.waitForFunction(
    ({ options: expected, silenceMs }) => {
      const request = window.__centerlineWorkerProbe.requests
        .filter((r) => JSON.stringify(r.options) === JSON.stringify(expected))
        .at(-1);
      if (request === undefined) throw Error('Missing real-worker trace');
      if (request.outcome === 'error') throw Error(request.message ?? 'Trace worker failed');
      if (request.outcome === 'ok') return true;
      if (performance.now() - request.lastMessageAt >= silenceMs)
        throw Error(`Trace worker went silent after ${request.beats} heartbeats`);
      return false;
    },
    { options, silenceMs: WORKER_SILENCE_MS },
    { timeout: TRACE_COMPLETION_MS, polling: 250 },
  );
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
          const now = performance.now();
          request.longestSilenceMs = Math.max(
            request.longestSilenceMs,
            now - request.lastMessageAt,
          );
          request.lastMessageAt = now;
          if (reply.kind === 'started') {
            request.startedAt = now;
            request.ticksAtStart = probe.ticks;
            window.dispatchEvent(new Event('centerline-worker-started'));
          } else if (reply.kind === 'progress') {
            // Still computing: the request is not settled by a heartbeat.
            // Phase changes are real status messages, but do not prove the
            // native generator continued reporting at the heartbeat interval.
            if (reply.phase === undefined) request.beats++;
          } else {
            request.settledAt = now;
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
          const now = performance.now();
          probe.requests.push({
            owner,
            id: message.id,
            options: structuredClone(message.options),
            width: message.image.width,
            height: message.image.height,
            postedAt: now,
            startedAt: null,
            settledAt: null,
            lastMessageAt: now,
            longestSilenceMs: 0,
            outcome: null,
            beats: 0,
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
