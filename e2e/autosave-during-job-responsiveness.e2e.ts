// Measures what an interval autosave costs the UI thread while a laser job
// streams (ADR-305 Amendment 1, annoyance audit A1 finding A4-P2-1).
//
// A paced GRBL stand-in runs a real Frame and Start on the window route, where
// the UI thread itself refills the controller, so anything that blocks that
// thread shows as a gap between acknowledgements. While the job streams the
// spec first edits the project and waits for the app's own 30 s loop to write
// it, then times autosaves of projects of several sizes: long tasks, the
// longest gap between acknowledgements and between written lines, how long a
// real key press waits for the thread, and what the window paid to hand the
// project to the autosave worker. It ends with one real Ctrl+. pressed while
// autosaves run back to back, timed to the soft reset on the wire.

import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectMachineAndDismissFirstSetup } from './fixtures/workspace-ui';

const pacedSerialSource = readFileSync(
  fileURLToPath(new URL('./fixtures/paced-grbl-serial.js', import.meta.url)),
  'utf8',
);

const BLOCKS_PER_SECOND = Number(process.env['AUTOSAVE_JOB_BLOCKS_PER_SECOND'] ?? 300);
const GRID = Number(process.env['AUTOSAVE_JOB_GRID'] ?? 10);
const CASES = (
  process.env['AUTOSAVE_JOB_CASES'] ??
  'svg-200,svg-2000,trace-400k,photo-1,svg-10000,trace-1000k,photo-4'
).split(',');
// The case autosaved back to back while Ctrl+. is pressed; 'none' presses it
// with no autosave running, for the comparison.
const ABORT_CASE = process.env['AUTOSAVE_JOB_ABORT_CASE'] ?? 'photo-1';
const WRITES = Number(process.env['AUTOSAVE_JOB_WRITES'] ?? 4);
// Diagnostic: a Chrome trace of the timed autosaves, written to this file. The
// probe marks every gap over 50 ms ("beat-gap") so it can be found in the trace.
const TRACE_FILE = process.env['AUTOSAVE_JOB_TRACE'];
const SOFT_RESET = 0x18;

interface Cadence {
  readonly elapsedMs: number;
  readonly acksPerSecond: number;
  readonly maxAckGapMs: number;
  readonly maxWriteGapMs: number;
  readonly maxBeatGapMs: number;
  readonly longTasks: number;
  readonly longTaskTotalMs: number;
  readonly maxLongTaskMs: number;
  readonly keyPresses: number;
  readonly maxKeyDelayMs: number;
}

interface MeasureWindow {
  __AUTOSAVE_JOB__: {
    write: () => Promise<{ readonly kind: string }>;
    handOffMs: () => number | null;
    loop: boolean;
  };
  __AUTOSAVE_JOB_CADENCE__: { reset: () => void; read: () => Cadence };
  __PACED_GRBL__: {
    readonly stats: { acked: number; written: number };
    readonly realtime: { readonly byte: number; readonly t: number }[];
  };
}

// A measurement, not a gate: it takes minutes and its numbers depend on the
// machine. Run it with KERFDESK_AUTOSAVE_JOB_PERF=1 (ADR-305 Amendment 1
// records the method and the numbers it gave).
test.skip(process.env['KERFDESK_AUTOSAVE_JOB_PERF'] !== '1', 'opt-in performance measurement');

test('autosave during a streaming job leaves the UI thread to the job', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(1_200_000);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.addInitScript({
    content: `window.__PACED_GRBL_CONFIG__ = { blocksPerSecond: ${BLOCKS_PER_SECOND} };`,
  });
  await page.addInitScript({ content: pacedSerialSource });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open...', exact: true }).first()).toBeVisible({
    timeout: 600_000,
  });
  await installFillProject(page, GRID);
  await dismissNotifications(page);
  await selectMachinePanel(page);
  await connectMachineAndDismissFirstSetup(page);
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled({
    timeout: 480_000,
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review job before starting' });
  await expect(review).toBeVisible({ timeout: 240_000 });
  const ackedBeforeStart = await simAcked(page);
  await review.getByRole('button', { name: 'Start job' }).click();
  await expect
    .poll(async () => (await simAcked(page)) - ackedBeforeStart, { timeout: 240_000 })
    .toBeGreaterThan(200);
  await page.waitForTimeout(3_000);
  const streamAtStart = await streamProbe(page);
  expect(streamAtStart.status).toBe('streaming');

  // The app's own loop: an edit made during the job gets its recovery copy.
  const editedAt = await editProjectNotes(page, 'drawn while the job ran');
  await expect
    .poll(() => newestAutosaveSavedAt(page), { timeout: 60_000, intervals: [1_000] })
    .toBeGreaterThanOrEqual(editedAt);
  const loopCopyAfterMs = (await newestAutosaveSavedAt(page)) - editedAt;
  await expect(page.locator('.lf-status-bar__alert')).toHaveCount(0);

  await installCadenceProbe(page);
  const cdp = await page.context().newCDPSession(page);
  const baseline: Cadence[] = [];
  for (let index = 0; index < 3; index += 1) {
    baseline.push((await measure(page, cdp, false)).cadence);
  }
  const cases: Record<string, unknown> = {};
  if (TRACE_FILE !== undefined) {
    await browser.startTracing(page, {
      categories: [
        'toplevel',
        'v8',
        'v8.gc',
        'devtools.timeline',
        'blink.user_timing',
        'disabled-by-default-v8.gc',
      ],
    });
  }
  for (const name of CASES) {
    const built = await buildCase(page, name);
    const writes = [];
    for (let index = 0; index < WRITES; index += 1) writes.push(await measure(page, cdp, true));
    for (const write of writes) expect(write.result, `${name} autosave`).toBe('ok');
    cases[name] = { ...built, writes };
  }
  if (TRACE_FILE !== undefined) writeFileSync(TRACE_FILE, await browser.stopTracing());
  const streamAfterWrites = await streamProbe(page);
  expect(streamAfterWrites.status).toBe('streaming');

  // One real Abort, pressed while autosaves of ABORT_CASE run back to back.
  if (ABORT_CASE !== 'none') {
    await buildCase(page, ABORT_CASE);
    await page.evaluate(() => {
      const w = window as unknown as MeasureWindow;
      w.__AUTOSAVE_JOB__.loop = true;
      void (async () => {
        while (w.__AUTOSAVE_JOB__.loop) await w.__AUTOSAVE_JOB__.write();
      })();
    });
  }
  await page.waitForTimeout(Number(process.env['AUTOSAVE_JOB_ABORT_AFTER_MS'] ?? 700));
  const pressedAt = await pressAbort(cdp);
  await page.waitForTimeout(3_000);
  const realtime = await page.evaluate(() =>
    (window as unknown as MeasureWindow).__PACED_GRBL__.realtime.map((entry) => ({
      byte: entry.byte,
      t: performance.timeOrigin + entry.t,
    })),
  );
  await page.evaluate(() => {
    const job = (window as unknown as Partial<MeasureWindow>).__AUTOSAVE_JOB__;
    if (job !== undefined) job.loop = false;
  });
  const reset = realtime.find((entry) => entry.t >= pressedAt - 5 && entry.byte === SOFT_RESET);
  const abortDelayMs = reset === undefined ? null : Math.round(reset.t - pressedAt);
  expect(abortDelayMs, 'Ctrl+. reached the controller').not.toBeNull();

  const summary = {
    blocksPerSecond: BLOCKS_PER_SECOND,
    streamAtStart,
    streamAfterWrites,
    loopCopyAfterMs,
    baseline,
    cases,
    abort: { during: ABORT_CASE, delayMs: abortDelayMs },
  };
  const outFile = process.env['AUTOSAVE_JOB_OUT'] ?? testInfo.outputPath('autosave-job.json');
  writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 1));
});

/** One autosave of the built case, or four idle seconds, with a key pressed throughout. */
async function measure(
  page: Page,
  cdp: CDPSession,
  write: boolean,
): Promise<{ result: string; writeMs: number; handOffMs: number | null; cadence: Cadence }> {
  await page.evaluate(() => (window as unknown as MeasureWindow).__AUTOSAVE_JOB_CADENCE__.reset());
  let pressing = true;
  const presser = (async () => {
    // F8 is bound to nothing: its handler delay is how long any key waits.
    const key = { key: 'F8', code: 'F8', windowsVirtualKeyCode: 119, nativeVirtualKeyCode: 119 };
    while (pressing) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  })();
  const outcome = write
    ? await page.evaluate(async () => {
        const job = (window as unknown as MeasureWindow).__AUTOSAVE_JOB__;
        const started = performance.now();
        const written = await job.write();
        const writeMs = Math.round(performance.now() - started);
        // Let the last callbacks and any collection land inside the window.
        await new Promise((resolve) => setTimeout(resolve, 400));
        const handOff = job.handOffMs();
        return {
          result: written.kind,
          writeMs,
          handOffMs: handOff === null ? null : Math.round(handOff * 10) / 10,
        };
      })
    : await page.evaluate(
        () =>
          new Promise<{ result: string; writeMs: number; handOffMs: number | null }>((resolve) =>
            setTimeout(() => resolve({ result: 'idle', writeMs: 0, handOffMs: null }), 4_000),
          ),
      );
  pressing = false;
  await presser;
  const cadence = await page.evaluate(() =>
    (window as unknown as MeasureWindow).__AUTOSAVE_JOB_CADENCE__.read(),
  );
  return { ...outcome, cadence };
}

async function installCadenceProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as MeasureWindow;
    const stats = w.__PACED_GRBL__.stats;
    const state = {
      acked: stats.acked,
      written: stats.written,
      lastAck: performance.now(),
      lastWrite: performance.now(),
      maxAckGap: 0,
      maxWriteGap: 0,
      acks: 0,
      lastBeat: performance.now(),
      maxBeatGap: 0,
      longTasks: [] as number[],
      keyDelays: [] as number[],
      startedAt: performance.now(),
    };
    // The stand-in counts each acknowledgement and each written line; stamp them.
    Object.defineProperty(stats, 'acked', {
      get: () => state.acked,
      set: (value: number) => {
        const now = performance.now();
        state.maxAckGap = Math.max(state.maxAckGap, now - state.lastAck);
        state.lastAck = now;
        state.acks += 1;
        state.acked = value;
      },
    });
    Object.defineProperty(stats, 'written', {
      get: () => state.written,
      set: (value: number) => {
        const now = performance.now();
        state.maxWriteGap = Math.max(state.maxWriteGap, now - state.lastWrite);
        state.lastWrite = now;
        state.written = value;
      },
    });
    window.setInterval(() => {
      const now = performance.now();
      const gap = now - state.lastBeat;
      if (gap > 50) performance.mark(`beat-gap:${Math.round(gap)}`);
      state.maxBeatGap = Math.max(state.maxBeatGap, gap);
      state.lastBeat = now;
    }, 5);
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
    });
    observer.observe({ entryTypes: ['longtask'] });
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'F8') state.keyDelays.push(performance.now() - event.timeStamp);
      },
      true,
    );
    w.__AUTOSAVE_JOB_CADENCE__ = {
      reset: () => {
        observer.takeRecords();
        const now = performance.now();
        state.lastAck = now;
        state.lastWrite = now;
        state.lastBeat = now;
        state.maxAckGap = 0;
        state.maxWriteGap = 0;
        state.maxBeatGap = 0;
        state.acks = 0;
        state.longTasks = [];
        state.keyDelays = [];
        state.startedAt = now;
      },
      read: () => {
        for (const entry of observer.takeRecords()) state.longTasks.push(entry.duration);
        const elapsed = performance.now() - state.startedAt;
        return {
          elapsedMs: Math.round(elapsed),
          acksPerSecond: Math.round((state.acks * 1000) / Math.max(1, elapsed)),
          maxAckGapMs: Math.round(state.maxAckGap),
          maxWriteGapMs: Math.round(state.maxWriteGap),
          maxBeatGapMs: Math.round(state.maxBeatGap),
          longTasks: state.longTasks.length,
          longTaskTotalMs: Math.round(state.longTasks.reduce((a, b) => a + b, 0)),
          maxLongTaskMs: Math.round(Math.max(0, ...state.longTasks)),
          keyPresses: state.keyDelays.length,
          maxKeyDelayMs: Math.round(Math.max(0, ...state.keyDelays)),
        };
      },
    };
  });
}

/** Builds a project of the named size and the autosave call the measurement times. */
async function buildCase(
  page: Page,
  name: string,
): Promise<{ objects: number; weight: number; allowedDuringJob: boolean }> {
  return page.evaluate(async (caseName) => {
    const scenePath = '/src/core/scene/index.ts';
    const durablePath = '/src/ui/state/autosave-durable.ts';
    const clientPath = '/src/ui/state/autosave-preparation-client.ts';
    const weightPath = '/src/ui/state/autosave-hand-off-weight.ts';
    const gatePath = '/src/ui/state/autosave-job-gate.ts';
    const scene = (await import(/* @vite-ignore */ scenePath)) as {
      createProject: () => Record<string, unknown> & { scene: Record<string, unknown> };
      createLayer: (args: { id: string; color: string; mode?: string }) => Record<string, unknown>;
      IDENTITY_TRANSFORM: unknown;
    };
    const durable = (await import(/* @vite-ignore */ durablePath)) as {
      projectAutosaveService: { write: (project: unknown) => Promise<{ kind: string }> };
    };
    const client = (await import(/* @vite-ignore */ clientPath)) as {
      lastAutosaveHandOffMs: () => number | null;
    };
    const weigher = (await import(/* @vite-ignore */ weightPath)) as {
      autosaveHandOffWeight: (project: unknown) => number;
    };
    const gates = (await import(/* @vite-ignore */ gatePath)) as {
      createAutosaveJobGate: () => { allows: (project: unknown) => boolean };
    };
    const ring = (cx: number, cy: number, r: number, n: number) => ({
      closed: true,
      points: Array.from({ length: n }, (_, i) => ({
        x: Math.round((cx + r * Math.cos((i / n) * Math.PI * 2)) * 1000) / 1000,
        y: Math.round((cy + r * Math.sin((i / n) * Math.PI * 2)) * 1000) / 1000,
      })),
    });
    const svg = (id: string, polylines: unknown[], x: number, y: number, size: number) => ({
      kind: 'imported-svg',
      id,
      source: `${id}.svg`,
      operationIds: ['line'],
      bounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
      transform: scene.IDENTITY_TRANSFORM,
      paths: [{ color: '#000000', polylines }],
    });
    const base64 = (bytes: number): string => {
      const chunk = new Uint8Array(3 * 8192);
      let out = '';
      for (let done = 0; done < bytes; done += chunk.length) {
        const part = done + chunk.length <= bytes ? chunk : chunk.subarray(0, bytes - done);
        for (let index = 0; index < part.length; index += 1)
          part[index] = (done + index * 31) & 255;
        out += btoa(String.fromCharCode(...part));
      }
      return out;
    };
    let objects: unknown[];
    let layers: unknown[] = [scene.createLayer({ id: 'line', color: '#000000', mode: 'line' })];
    if (caseName.startsWith('svg-')) {
      const count = Number(caseName.slice(4));
      const side = Math.ceil(Math.sqrt(count));
      objects = Array.from({ length: count }, (_, i) => {
        const x = (i % side) * 3;
        const y = Math.floor(i / side) * 3;
        return svg(`o${i}`, [ring(x + 1, y + 1, 1, 12)], x, y, 2);
      });
    } else if (/^trace-\d+k$/.test(caseName)) {
      // One traced image: polylines of 100 points each.
      const polylines = Array.from({ length: Number(caseName.slice(6, -1)) * 10 }, (_, i) =>
        ring((i % 100) * 3 + 1, Math.floor(i / 100) * 3 + 1, 1, 100),
      );
      objects = [svg('trace', polylines, 0, 0, 300)];
    } else if (caseName.startsWith('photo-')) {
      // 12 MP each: the luma buffer the burn uses and a 4.5 MB source file.
      const width = 4000;
      const height = 3000;
      const lumaBase64 = base64(width * height);
      const dataUrl = `data:image/png;base64,${base64(4_500_000)}`;
      layers = [scene.createLayer({ id: 'image', color: '#808080', mode: 'image' })];
      objects = Array.from({ length: Number(caseName.slice(6)) }, (_, i) => ({
        kind: 'raster-image',
        id: `photo${i}`,
        source: `photo${i}.png`,
        dataUrl,
        lumaBase64,
        pixelWidth: width,
        pixelHeight: height,
        bounds: { minX: i * 10, minY: 0, maxX: i * 10 + 400, maxY: 300 },
        transform: scene.IDENTITY_TRANSFORM,
        color: '#808080',
        dither: 'floyd-steinberg',
        linesPerMm: 10,
      }));
    } else {
      throw new Error(`Unknown case ${caseName}`);
    }
    const base = scene.createProject();
    const project = { ...base, scene: { ...base.scene, layers, objects } };
    (window as unknown as MeasureWindow).__AUTOSAVE_JOB__ = {
      loop: false,
      write: () => durable.projectAutosaveService.write(project),
      handOffMs: () => client.lastAutosaveHandOffMs(),
    };
    return {
      objects: objects.length,
      weight: weigher.autosaveHandOffWeight(project),
      allowedDuringJob: gates.createAutosaveJobGate().allows(project),
    };
  }, name);
}

/** An edit as the canvas makes one: a new project value, marked unsaved. */
async function editProjectNotes(page: Page, notes: string): Promise<number> {
  return page.evaluate(async (text) => {
    const storePath = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ storePath)) as {
      useStore: {
        getState: () => { project: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    };
    const editedAt = Date.now();
    useStore.setState({ project: { ...useStore.getState().project, notes: text }, dirty: true });
    return editedAt;
  }, notes);
}

/** The save time of the newest snapshot any session holds in IndexedDB, or 0. */
async function newestAutosaveSavedAt(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('curvedesk-project-autosave-v1');
        open.onerror = () => resolve(0);
        open.onsuccess = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains('manifests')) {
            database.close();
            resolve(0);
            return;
          }
          const all = database
            .transaction('manifests', 'readonly')
            .objectStore('manifests')
            .getAll();
          all.onerror = () => resolve(0);
          all.onsuccess = () => {
            const manifests = all.result as { current: { savedAt: number } | null }[];
            database.close();
            resolve(Math.max(0, ...manifests.map((manifest) => manifest.current?.savedAt ?? 0)));
          };
        };
      }),
  );
}

async function pressAbort(cdp: CDPSession): Promise<number> {
  const key = {
    key: '.',
    code: 'Period',
    windowsVirtualKeyCode: 190,
    nativeVirtualKeyCode: 190,
    modifiers: 2,
  };
  const pressedAt = Date.now();
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  return pressedAt;
}

/** A 200 x 200 mm fill of rings: about 86,000 lines at the default grid. */
async function installFillProject(page: Page, grid: number): Promise<void> {
  await page.evaluate(async (count) => {
    const scenePath = '/src/core/scene/index.ts';
    const storePath = '/src/ui/state/store.ts';
    const scene = (await import(/* @vite-ignore */ scenePath)) as {
      createProject: () => Record<string, unknown> & { scene: Record<string, unknown> };
      createLayer: (args: { id: string; color: string; mode?: string }) => Record<string, unknown>;
      IDENTITY_TRANSFORM: unknown;
    };
    const { useStore } = (await import(/* @vite-ignore */ storePath)) as {
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
    const base = scene.createProject();
    useStore.getState().setProject({
      ...base,
      scene: {
        ...base.scene,
        layers: [
          { ...scene.createLayer({ id: 'fill', color: '#000000', mode: 'fill' }), speed: 6000 },
        ],
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

async function simAcked(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as MeasureWindow).__PACED_GRBL__.stats.acked);
}

async function streamProbe(page: Page): Promise<{
  readonly completed: number | null;
  readonly total: number | null;
  readonly status: string | null;
}> {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/laser-store.ts';
    const { useLaserStore } = (await import(/* @vite-ignore */ storePath)) as {
      useLaserStore: {
        getState: () => { streamer: { completed: number; total: number; status: string } | null };
      };
    };
    const streamer = useLaserStore.getState().streamer;
    return {
      completed: streamer?.completed ?? null,
      total: streamer?.total ?? null,
      status: streamer?.status ?? null,
    };
  });
}

async function dismissNotifications(page: Page): Promise<void> {
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while ((await notifications.count()) > 0) await notifications.first().click();
}

async function selectMachinePanel(page: Page): Promise<void> {
  await page.getByRole('region', { name: 'Workspace side panels', exact: true }).waitFor();
  const tab = page.getByRole('tab', { name: 'Machine', exact: true });
  if (await tab.isVisible()) await tab.click();
}
