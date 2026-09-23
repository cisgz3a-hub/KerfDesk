// Measures how responsive the workspace stays while a large laser job streams.
// A synthetic 200 x 200 mm fill at 0.1 mm spacing compiles to a few hundred
// thousand lines; a paced GRBL stand-in acknowledges them at machine pace so
// the host sees the same per-ack and per-status traffic as a real burn.

import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pacedSerialSource = readFileSync(
  fileURLToPath(new URL('./fixtures/paced-grbl-serial.js', import.meta.url)),
  'utf8',
);

const RUN_WINDOW_MS = Number(process.env['BIG_JOB_RUN_MS'] ?? 20_000);
const BLOCKS_PER_SECOND = Number(process.env['BIG_JOB_BLOCKS_PER_SECOND'] ?? 500);
const GRID = Number(process.env['BIG_JOB_GRID'] ?? 18);
// Production bundles cannot import /src modules, so a production run opens a
// project file dumped by an earlier dev run and reads progress from the fake
// controller's own acknowledgement counter.
const PROJECT_FILE = process.env['BIG_JOB_PROJECT_FILE'];
const DUMP_PROJECT = process.env['BIG_JOB_DUMP_PROJECT'];
const PROFILE_FRAME = process.env['BIG_JOB_PROFILE_FRAME'] === '1';
const PROFILE_START = process.env['BIG_JOB_PROFILE_START'] === '1';

interface RunProbe {
  readonly elapsedMs: number;
  readonly maxGapMs: number;
  readonly gapsOver50: number;
  readonly longTasks: number;
  readonly longTaskMs: number;
  readonly maxLongTaskMs: number;
  readonly frames: number;
  readonly p95FrameMs: number;
  readonly maxFrameMs: number;
  readonly maxEventMs: number;
  readonly ackedPerSecond: number;
  readonly heapStartMb: number;
  readonly heapEndMb: number;
}

// A measurement, not a gate: it takes minutes and its numbers depend on the
// machine. Run it with KERFDESK_BIG_JOB_PERF=1 (ADR-352 records the method).
test.skip(process.env['KERFDESK_BIG_JOB_PERF'] !== '1', 'opt-in performance measurement');

test('big job streaming keeps the workspace responsive', async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  await page.addInitScript({
    content: `window.__PACED_GRBL_CONFIG__ = { blocksPerSecond: ${BLOCKS_PER_SECOND} };`,
  });
  await page.addInitScript({ content: pacedSerialSource });
  if (PROJECT_FILE !== undefined) await installProjectPicker(page, PROJECT_FILE);
  if (process.env['BIG_JOB_TRACE_WORKERS'] === '1') await installWorkerTrace(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open...' })).toBeVisible({ timeout: 60_000 });
  if (PROJECT_FILE !== undefined) {
    await page.getByRole('button', { name: 'Open...' }).click();
    await expect(page).toHaveTitle(/big-job\.lf2/, { timeout: 120_000 });
  } else {
    await installBigFillProject(page, GRID);
    if (DUMP_PROJECT !== undefined)
      writeFileSync(DUMP_PROJECT, await serializeCurrentProject(page));
  }
  await dismissNotifications(page);

  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await expandMachineUtilities(page);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();

  const frameCdp = PROFILE_FRAME ? await page.context().newCDPSession(page) : null;
  if (frameCdp !== null) {
    await frameCdp.send('Profiler.enable');
    await frameCdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await frameCdp.send('Profiler.start');
  }
  const frameStarted = Date.now();
  await page.evaluate(() => {
    (window as unknown as { __WORKER_TRACE_MARK__?: number }).__WORKER_TRACE_MARK__ =
      performance.now();
  });
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start framed job', exact: true })).toBeEnabled({
    timeout: 240_000,
  });
  const frameMs = Date.now() - frameStarted;
  const frameWorkers = await page.evaluate(() => {
    const w = window as unknown as { __WORKER_TRACE__?: unknown[]; __WORKER_TRACE_MARK__?: number };
    const mark = w.__WORKER_TRACE_MARK__ ?? 0;
    return (w.__WORKER_TRACE__ ?? []).filter((event) => (event as { t: number }).t >= mark);
  });
  let frameProfile: unknown = null;
  if (frameCdp !== null) {
    const { profile } = (await frameCdp.send('Profiler.stop')) as { profile: CpuProfile };
    frameProfile = { busy: busyTime(profile), top: summariseProfile(profile).slice(0, 80) };
  }

  const startClicked = Date.now();
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review job before starting' });
  await expect(review).toBeVisible({ timeout: 240_000 });
  const reviewMs = Date.now() - startClicked;
  const ackedBeforeStart = await simAcked(page);
  await armInteractionProbe(page);
  const startCdp = PROFILE_START ? await page.context().newCDPSession(page) : null;
  if (startCdp !== null) {
    await startCdp.send('Profiler.enable');
    await startCdp.send('Profiler.setSamplingInterval', { interval: 250 });
    await startCdp.send('Profiler.start');
  }
  const confirmClicked = Date.now();
  await review.getByRole('button', { name: 'Start job' }).click();
  await expect
    .poll(async () => (await simAcked(page)) - ackedBeforeStart, { timeout: 240_000 })
    .toBeGreaterThan(200);
  const streamingMs = Date.now() - startClicked;
  const confirmToStreamingMs = Date.now() - confirmClicked;
  // Keep observing the first seconds of the run, where Start-time work lands.
  await page.waitForTimeout(3_000);
  const startPhase = await readInteractionProbe(page);
  let startProfile: unknown = null;
  if (startCdp !== null) {
    const { profile } = (await startCdp.send('Profiler.stop')) as { profile: CpuProfile };
    startProfile = { busy: busyTime(profile), top: summariseProfile(profile).slice(0, 90) };
  }
  const total = (await streamProbe(page)).total;

  const idleWindow = await measure(page, 3_000, null);
  const cdp = await page.context().newCDPSession(page);
  const retainedStartMb = await retainedHeapMb(page, cdp);
  const runWindow = await measure(page, RUN_WINDOW_MS, cdp);
  const retainedEndMb = await retainedHeapMb(page, cdp);
  const interaction = await interactDuringRun(page);
  const progress = await streamProbe(page);

  const summary = {
    total,
    frameMs,
    reviewMs,
    streamingMs,
    confirmToStreamingMs,
    startPhase,
    progress,
    firstWindow: idleWindow.probe,
    runWindow: runWindow.probe,
    retainedHeap: { startMb: retainedStartMb, endMb: retainedEndMb },
    interaction,
    topSelf: runWindow.topSelf,
    frameProfile,
    frameWorkers,
    startProfile,
  };
  const outFile = process.env['BIG_JOB_OUT'] ?? testInfo.outputPath('big-job-run.json');
  writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, topSelf: runWindow.topSelf.slice(0, 40) }, null, 2));
  expect(progress.status).not.toBe('error');
});

async function measure(
  page: Page,
  durationMs: number,
  cdp: CDPSession | null,
): Promise<{ probe: RunProbe; topSelf: readonly SelfEntry[] }> {
  if (cdp !== null) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    await cdp.send('Profiler.start');
  }
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
    const probe = {
      startedAt: performance.now(),
      lastTick: performance.now(),
      maxGap: 0,
      gapsOver50: 0,
      longTasks: [] as number[],
      frames: [] as number[],
      lastFrame: performance.now(),
      events: [] as number[],
      stop: false,
      ackedAtStart: (w['__PACED_GRBL__'] as { stats: { acked: number } }).stats.acked,
      heapStart: perf.memory?.usedJSHeapSize ?? 0,
      timer: 0,
      observers: [] as PerformanceObserver[],
    };
    probe.timer = window.setInterval(() => {
      const now = performance.now();
      const gap = now - probe.lastTick;
      if (gap > 50) probe.gapsOver50 += 1;
      probe.maxGap = Math.max(probe.maxGap, gap);
      probe.lastTick = now;
    }, 10);
    const longTasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longTasks.push(entry.duration);
    });
    longTasks.observe({ entryTypes: ['longtask'] });
    const events = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.events.push(entry.duration);
    });
    events.observe({
      type: 'event',
      durationThreshold: 16,
      buffered: false,
    } as PerformanceObserverInit);
    probe.observers.push(longTasks, events);
    const frame = (): void => {
      if (probe.stop) return;
      const now = performance.now();
      probe.frames.push(now - probe.lastFrame);
      probe.lastFrame = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    w['__RUN_PROBE__'] = probe;
  });
  await page.waitForTimeout(durationMs);
  const probe = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
    const state = w['__RUN_PROBE__'] as {
      startedAt: number;
      lastTick: number;
      maxGap: number;
      gapsOver50: number;
      longTasks: number[];
      frames: number[];
      events: number[];
      stop: boolean;
      ackedAtStart: number;
      heapStart: number;
      timer: number;
      observers: PerformanceObserver[];
    };
    state.stop = true;
    window.clearInterval(state.timer);
    for (const observer of state.observers) {
      for (const entry of observer.takeRecords()) {
        if (entry.entryType === 'longtask') state.longTasks.push(entry.duration);
        else state.events.push(entry.duration);
      }
      observer.disconnect();
    }
    const elapsed = performance.now() - state.startedAt;
    const frames = [...state.frames].sort((a, b) => a - b);
    const acked = (w['__PACED_GRBL__'] as { stats: { acked: number } }).stats.acked;
    return {
      elapsedMs: Math.round(elapsed),
      maxGapMs: Math.round(state.maxGap),
      gapsOver50: state.gapsOver50,
      longTasks: state.longTasks.length,
      longTaskMs: Math.round(state.longTasks.reduce((sum, value) => sum + value, 0)),
      maxLongTaskMs: Math.round(Math.max(0, ...state.longTasks)),
      frames: frames.length,
      p95FrameMs: Math.round(frames[Math.floor(frames.length * 0.95)] ?? 0),
      maxFrameMs: Math.round(frames[frames.length - 1] ?? 0),
      maxEventMs: Math.round(Math.max(0, ...state.events)),
      ackedPerSecond: Math.round(((acked - state.ackedAtStart) * 1000) / elapsed),
      heapStartMb: Math.round(state.heapStart / 1e6),
      heapEndMb: Math.round((perf.memory?.usedJSHeapSize ?? 0) / 1e6),
    };
  });
  let topSelf: readonly SelfEntry[] = [];
  let busy: Record<string, number> = {};
  if (cdp !== null) {
    const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
    topSelf = summariseProfile(profile);
    busy = busyTime(profile);
  }
  return { probe: { ...probe, ...busy }, topSelf };
}

interface CpuProfileNode {
  readonly id: number;
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
  };
  readonly children?: readonly number[];
}
interface CpuProfile {
  readonly nodes: readonly CpuProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}
interface SelfEntry {
  readonly key: string;
  readonly selfMs: number;
  readonly totalMs: number;
  readonly callers: readonly string[];
}

function busyTime(profile: CpuProfile): Record<string, number> {
  const kind = new Map(profile.nodes.map((node) => [node.id, node.callFrame.functionName]));
  let total = 0;
  let idle = 0;
  let gc = 0;
  let program = 0;
  profile.samples.forEach((id, index) => {
    const ms = (profile.timeDeltas[index] ?? 0) / 1000;
    total += ms;
    const name = kind.get(id);
    if (name === '(idle)') idle += ms;
    else if (name === '(garbage collector)') gc += ms;
    else if (name === '(program)') program += ms;
  });
  return {
    profiledMs: Math.round(total),
    busyMs: Math.round(total - idle),
    busyPct: Math.round(((total - idle) / Math.max(1, total)) * 100),
    scriptMs: Math.round(total - idle - gc - program),
    gcMs: Math.round(gc),
    programMs: Math.round(program),
  };
}

function frameKey(node: CpuProfileNode): string {
  const url = node.callFrame.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
  return `${node.callFrame.functionName || '(anon)'} ${url}:${node.callFrame.lineNumber + 1}`;
}

function summariseProfile(profile: CpuProfile): SelfEntry[] {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parent.set(child, node.id);
  const self = new Map<number, number>();
  profile.samples.forEach((id, index) => {
    self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  const selfByKey = new Map<string, number>();
  const totalByKey = new Map<string, number>();
  const callersByKey = new Map<string, Map<string, number>>();
  for (const [id, ms] of self) {
    const node = byId.get(id);
    if (node === undefined) continue;
    const key = frameKey(node);
    selfByKey.set(key, (selfByKey.get(key) ?? 0) + ms);
    const seen = new Set<string>();
    let cursor: number | undefined = id;
    const chain: string[] = [];
    while (cursor !== undefined) {
      const current = byId.get(cursor);
      if (current === undefined) break;
      const currentKey = frameKey(current);
      if (!seen.has(currentKey)) {
        seen.add(currentKey);
        totalByKey.set(currentKey, (totalByKey.get(currentKey) ?? 0) + ms);
      }
      if (cursor !== id && chain.length < 6) chain.push(currentKey);
      cursor = parent.get(cursor);
    }
    const callers = callersByKey.get(key) ?? new Map<string, number>();
    const chainKey = chain.join(' < ');
    callers.set(chainKey, (callers.get(chainKey) ?? 0) + ms);
    callersByKey.set(key, callers);
  }
  const selfEntries = [...selfByKey.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([key, ms]) => ({
      key,
      selfMs: Math.round(ms),
      totalMs: Math.round(totalByKey.get(key) ?? 0),
      callers: [...(callersByKey.get(key) ?? new Map()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([chain, callerMs]) => `${Math.round(callerMs)}ms ${chain}`),
    }));
  const inclusive = [...totalByKey.entries()]
    .filter(([key]) => key.includes('/src/'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([key, ms]) => ({
      key: `[incl] ${key}`,
      selfMs: Math.round(selfByKey.get(key) ?? 0),
      totalMs: Math.round(ms),
      callers: [],
    }));
  return [...selfEntries, ...inclusive];
}

async function interactDuringRun(page: Page): Promise<Record<string, number>> {
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  const bounds = await canvas.boundingBox();
  const timings: Record<string, number> = {};
  if (bounds === null) return timings;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const nextFrame = (): Promise<unknown> =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))),
        ),
    );

  // Hover: 60 pointer moves across the canvas, one per frame, as an operator
  // watching the burn would. Report wall time and the main-thread cost.
  await page.mouse.move(cx, cy);
  await nextFrame();
  await armInteractionProbe(page);
  const hoverStarted = Date.now();
  for (let index = 0; index < 60; index += 1) {
    const angle = (index / 60) * Math.PI * 2;
    await page.mouse.move(cx + Math.cos(angle) * 120, cy + Math.sin(angle) * 80);
    await nextFrame();
  }
  timings['hover60Ms'] = Date.now() - hoverStarted;
  Object.assign(timings, prefixed('hover', await readInteractionProbe(page)));

  // Zoom: four wheel notches, each timed to the second frame after it.
  await page.mouse.move(cx, cy);
  await nextFrame();
  await armInteractionProbe(page);
  const notchTimes: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const started = Date.now();
    await page.mouse.wheel(0, index < 2 ? -240 : 240);
    await nextFrame();
    notchTimes.push(Date.now() - started);
  }
  timings['zoomNotchMaxMs'] = Math.max(...notchTimes);
  timings['zoomNotchMeanMs'] = Math.round(
    notchTimes.reduce((a, b) => a + b, 0) / notchTimes.length,
  );
  // Let any deferred exact repaint land inside the measured window.
  await page.waitForTimeout(600);
  Object.assign(timings, prefixed('zoom', await readInteractionProbe(page)));

  await armInteractionProbe(page);
  const tabStarted = Date.now();
  await selectWorkspacePanel(page, 'Artwork');
  await nextFrame();
  await selectWorkspacePanel(page, 'Machine');
  await nextFrame();
  timings['panelSwitchMs'] = Date.now() - tabStarted;
  Object.assign(timings, prefixed('panel', await readInteractionProbe(page)));
  return timings;
}

function prefixed(prefix: string, values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`${prefix}.${key}`, value]),
  );
}

async function armInteractionProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const probe = { longTasks: [] as number[], observer: null as PerformanceObserver | null };
    probe.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longTasks.push(entry.duration);
    });
    probe.observer.observe({ entryTypes: ['longtask'] });
    w['__INTERACTION_PROBE__'] = probe;
  });
}

async function readInteractionProbe(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const probe = w['__INTERACTION_PROBE__'] as {
      longTasks: number[];
      observer: PerformanceObserver;
    };
    for (const entry of probe.observer.takeRecords()) probe.longTasks.push(entry.duration);
    probe.observer.disconnect();
    return {
      longTasks: probe.longTasks.length,
      longTaskMs: Math.round(probe.longTasks.reduce((a, b) => a + b, 0)),
      maxLongTaskMs: Math.round(Math.max(0, ...probe.longTasks)),
    };
  });
}

async function installBigFillProject(page: Page, grid: number): Promise<void> {
  await page.evaluate(async (count) => {
    const scenePath = '/src/core/scene/index.ts';
    const storePath = '/src/ui/state/store.ts';
    const [sceneModule, storeModule] = await Promise.all([
      import(/* @vite-ignore */ scenePath),
      import(/* @vite-ignore */ storePath),
    ]);
    const scene = sceneModule as {
      createProject: () => Record<string, unknown> & { scene: Record<string, unknown> };
      createLayer: (args: { id: string; color: string; mode?: string }) => Record<string, unknown>;
      IDENTITY_TRANSFORM: unknown;
    };
    const store = storeModule as {
      useStore: { getState: () => { setProject: (project: unknown) => void } };
    };
    const circle = (cx: number, cy: number, r: number) => ({
      closed: true,
      points: Array.from({ length: 96 }, (_, i) => ({
        x: Math.round((cx + r * Math.cos((i / 96) * Math.PI * 2)) * 1000) / 1000,
        y: Math.round((cy + r * Math.sin((i / 96) * Math.PI * 2)) * 1000) / 1000,
      })),
    });
    const origin = 20;
    const pitch = 200 / count;
    const polylines = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        const cx = origin + pitch * (column + 0.5);
        const cy = origin + pitch * (row + 0.5);
        polylines.push(circle(cx, cy, pitch * 0.45), circle(cx, cy, pitch * 0.22));
      }
    }
    const layer = {
      ...scene.createLayer({ id: 'fill', color: '#000000', mode: 'fill' }),
      speed: 6000,
    };
    const created = scene.createProject() as Record<string, unknown> & {
      scene: Record<string, unknown>;
      device: Record<string, unknown>;
      jobSetup: { placement: Record<string, unknown> };
    };
    const base = {
      ...created,
      device: { ...created.device, homing: { enabled: true, direction: 'front-left' } },
      jobSetup: {
        ...created.jobSetup,
        placement: { ...created.jobSetup.placement, startFrom: 'absolute' },
      },
    };
    store.useStore.getState().setProject({
      ...base,
      scene: {
        ...base.scene,
        layers: [layer],
        objects: [
          {
            kind: 'imported-svg',
            id: 'rings',
            source: 'rings.svg',
            operationIds: ['fill'],
            bounds: { minX: origin, minY: origin, maxX: origin + 200, maxY: origin + 200 },
            transform: scene.IDENTITY_TRANSFORM,
            paths: [{ color: '#000000', polylines }],
          },
        ],
      },
    });
  }, grid);
}

// Live heap after a forced full collection: what the run actually retains,
// as opposed to garbage awaiting the next GC.
async function retainedHeapMb(_page: Page, cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
  return Math.round(usedSize / 1e6);
}

// Diagnostic: records every worker created and every message across the
// boundary, so a slow phase can be attributed to work queued on a worker.
async function installWorkerTrace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const trace: Record<string, unknown>[] = [];
    (window as unknown as { __WORKER_TRACE__: unknown[] }).__WORKER_TRACE__ = trace;
    const Native = window.Worker;
    let nextId = 0;
    class TracedWorker extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const id = (nextId += 1);
        const name = String(url).replace(/^.*\//, '').replace(/\?.*$/, '');
        trace.push({ t: performance.now(), id, name, kind: 'new' });
        const post = this.postMessage.bind(this);
        this.postMessage = ((message: unknown, transfer?: Transferable[]) => {
          const kind =
            (message as { kind?: string; type?: string } | null)?.kind ??
            (message as { type?: string } | null)?.type;
          trace.push({ t: performance.now(), id, name, kind: 'post', message: kind });
          return transfer === undefined ? post(message) : post(message, transfer);
        }) as Worker['postMessage'];
        this.addEventListener('message', (event) => {
          const data = event.data as { kind?: string; type?: string } | null;
          trace.push({
            t: performance.now(),
            id,
            name,
            kind: 'reply',
            message: data?.kind ?? data?.type,
          });
        });
        this.addEventListener('error', () =>
          trace.push({ t: performance.now(), id, name, kind: 'error' }),
        );
      }
    }
    window.Worker = TracedWorker as typeof Worker;
  });
}

async function simAcked(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __PACED_GRBL__: { stats: { acked: number } } }).__PACED_GRBL__.stats
        .acked,
  );
}

async function installProjectPicker(page: Page, projectFile: string): Promise<void> {
  const text = readFileSync(projectFile, 'utf8');
  await page.route('**/__big-job__.lf2', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: text }),
  );
  await page.addInitScript(() => {
    const picker = async (): Promise<unknown[]> => [
      {
        kind: 'file',
        name: 'big-job.lf2',
        getFile: async () => {
          const response = await fetch('/__big-job__.lf2');
          return new File([await response.text()], 'big-job.lf2', { type: 'application/json' });
        },
      },
    ];
    (window as unknown as { showOpenFilePicker: typeof picker }).showOpenFilePicker = picker;
  });
}

async function serializeCurrentProject(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const serializePath = '/src/io/project/serialize-project.ts';
    const storePath = '/src/ui/state/store.ts';
    const [serializeModule, storeModule] = await Promise.all([
      import(/* @vite-ignore */ serializePath),
      import(/* @vite-ignore */ storePath),
    ]);
    const { serializeProject } = serializeModule as {
      serializeProject: (p: unknown, options: { compact: boolean }) => string;
    };
    const { useStore } = storeModule as { useStore: { getState: () => { project: unknown } } };
    return serializeProject(useStore.getState().project, { compact: true });
  });
}

async function streamProbe(page: Page): Promise<{
  readonly completed: number | null;
  readonly total: number | null;
  readonly status: string | null;
}> {
  if (PROJECT_FILE !== undefined) {
    return { completed: await simAcked(page), total: null, status: 'production' };
  }
  return page.evaluate(async () => {
    const moduleUrl = '/src/ui/state/laser-store.ts';
    const { useLaserStore } = (await import(/* @vite-ignore */ moduleUrl)) as {
      useLaserStore: {
        getState: () => {
          streamer: { completed: number; total: number; status: string } | null;
        };
      };
    };
    const state = useLaserStore.getState();
    return {
      completed: state.streamer?.completed ?? null,
      total: state.streamer?.total ?? null,
      status: state.streamer?.status ?? null,
    };
  });
}

async function dismissNotifications(page: Page): Promise<void> {
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while ((await notifications.count()) > 0) await notifications.first().click();
}

async function expandMachineUtilities(page: Page): Promise<void> {
  const summary = page.locator('.lf-machine-rail summary').filter({
    hasText: /^Homing & (focus|maintenance)$/,
  });
  if ((await summary.locator('..').getAttribute('open')) === null) await summary.click();
}

async function selectWorkspacePanel(page: Page, name: 'Artwork' | 'Machine'): Promise<void> {
  await page.getByRole('region', { name: 'Workspace side panels', exact: true }).waitFor();
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.isVisible()) await tab.click();
}
