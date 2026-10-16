import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import asar from '@electron/asar';
import { verifyObservationOwner } from './packaged-observation-owner.mjs';
import {
  freePackageEvidence,
  packageEvidenceForOwner,
  panPlan,
  runPan,
  runProbe,
  validateEndpoint,
  verifyBrowserProcess,
} from './packaged-trace-navigation.mjs';
import { NATIVE_CANVAS_OBSERVER_SOURCE } from './packaged-canvas-observer.mjs';

test('only explicit loopback endpoints and non-commercial packages qualify', () => {
  assert.equal(validateEndpoint('http://127.0.0.1:9223'), 'http://127.0.0.1:9223/');
  for (const endpoint of [
    'https://127.0.0.1:9223',
    'http://example.com:9223',
    'http://user@127.0.0.1:9223',
    'http://127.0.0.1:9223/path',
    'http://127.0.0.1:9223?x=1',
  ]) {
    assert.throws(() => validateEndpoint(endpoint));
  }
  assert.equal(freePackageEvidence({ version: '0.1.0' }).licensingChannel, 'free');
  for (const commercial of [null, false, {}, { schema: 1 }]) {
    assert.throws(
      () => freePackageEvidence({ version: '1.0.18', kerfdeskCommercialLicense: commercial }),
      /commercial/,
    );
  }
});

test('fixed pan stays within the canvas and rejects missing or unusable bounds', () => {
  assert.deepEqual(panPlan({ x: 20, y: 30, width: 1200, height: 600 }), {
    start: { x: 620, y: 330 },
    dx: 60,
    dy: 24,
    steps: 12,
  });
  for (const rect of [
    null,
    { x: 0, y: 0, width: 0, height: 0 },
    { x: NaN, y: 0, width: 1200, height: 800 },
  ])
    assert.throws(() => panPlan(rect));
});

test('bounded pan uses a middle button and releases it if a move fails', async () => {
  const events = [];
  let moveCount = 0;
  const page = {
    evaluate: async (source) =>
      typeof source === 'function' ? { x: 0, y: 0, width: 1200, height: 600 } : { commands: {} },
    mouse: {
      move: async (x, y) => {
        events.push(['move', x, y]);
        if (++moveCount === 3) throw new Error('input transport interrupted');
      },
      down: async (options) => {
        events.push(['down', options]);
      },
      up: async (options) => {
        events.push(['up', options]);
      },
    },
  };
  await assert.rejects(runPan(page), /transport interrupted/);
  assert.deepEqual(events.at(-1), ['up', { button: 'middle' }]);
  assert.equal(events.filter(([event]) => event === 'down').length, 1);
});

function fakeRenderer() {
  const calls = [];
  const originals = {};
  const methods = ['drawImage', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke'];
  function Context(canvas) {
    this.canvas = canvas;
  }
  function OffscreenContext(canvas) {
    this.canvas = canvas;
  }
  for (const method of methods) {
    const implementation = function (...args) {
      calls.push([this.canvas, method, args]);
      return 17;
    };
    originals[method] = implementation;
    Context.prototype[method] = implementation;
    OffscreenContext.prototype[method] = implementation;
  }
  const canvas = {
    width: 1920,
    height: 1080,
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 960, height: 540 }),
  };
  const status = {
    textContent: 'Trace ready · 1,500 paths · 180,000 nodes',
    getAttribute: () => 'ready',
  };
  const listeners = new Map();
  const document = {
    visibilityState: 'visible',
    querySelector: (selector) =>
      selector.startsWith('canvas')
        ? canvas
        : selector === '.lf-trace-preview__status'
          ? status
          : { value: 'Line Art' },
    querySelectorAll: () => [1, 2],
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  let time = 0;
  let frameCallback;
  const context = vm.createContext({
    window: {},
    document,
    CanvasRenderingContext2D: Context,
    OffscreenCanvasRenderingContext2D: OffscreenContext,
    devicePixelRatio: 2,
    performance: { now: () => time },
    requestAnimationFrame: (callback) => {
      frameCallback = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      frameCallback = null;
    },
  });
  return {
    context,
    canvas,
    Context,
    OffscreenContext,
    listeners,
    originals,
    calls,
    frame: (now) => {
      time = now;
      frameCallback(now);
    },
  };
}

test('passive observer forwards commands, separates canvas targets and restores originals', () => {
  const fixture = fakeRenderer();
  let longTaskCallback;
  let clearedLongTaskRecords = 0;
  fixture.context.PerformanceObserver = class {
    static supportedEntryTypes = ['longtask'];
    constructor(callback) {
      longTaskCallback = callback;
    }
    observe(options) {
      assert.equal(options.type, 'longtask');
    }
    takeRecords() {
      clearedLongTaskRecords += 1;
      return [];
    }
    disconnect() {
      longTaskCallback = null;
    }
  };
  vm.runInContext(NATIVE_CANVAS_OBSERVER_SOURCE, fixture.context);
  const observer = fixture.context.window.__kerfdeskNativeCanvasObservation;
  const main = new fixture.Context(fixture.canvas);
  assert.equal(main.lineTo(10, 20), 17);
  main.drawImage('image', 0, 0);
  new fixture.Context({ hidden: true }).fill('evenodd');
  new fixture.OffscreenContext({ offscreen: true }).stroke();
  const input = {
    target: fixture.canvas,
    type: 'wheel',
    buttons: 0,
    button: 0,
    clientX: 100,
    clientY: 200,
    deltaX: 0,
    deltaY: -100,
    deltaMode: 0,
  };
  fixture.listeners.get('wheel')({ ...input, isTrusted: false });
  fixture.listeners.get('wheel')({ ...input, isTrusted: true });
  fixture.frame(0);
  fixture.frame(16);
  longTaskCallback({ getEntries: () => [{ startTime: 0, duration: 65 }] });
  const result = observer.snapshot();
  assert.equal(result.commands.workspace.lineTo, 1);
  assert.equal(result.commands.workspace.drawImage, 1);
  assert.equal(result.commands.otherCanvas2d.fill, 1);
  assert.equal(result.commands.offscreenCanvas2d.stroke, 1);
  assert.equal(result.inputs.wheel, 1);
  assert.equal(result.inputs.syntheticIgnored, 1);
  assert.equal(result.navigationFrameIntervals.count, 1);
  assert.equal(result.longTasks.count, 1);
  assert.equal(result.lastTrace.displayedPathCount, 1500);
  assert.equal(result.lastTrace.displayedNodeCount, 180000);
  assert.equal(result.nodePrimitives.require, 'undefined');
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(fixture.calls[0].slice(1), ['lineTo', [10, 20]]);
  const reset = observer.reset();
  assert.equal(reset.commands.workspace.lineTo, 0);
  assert.equal(reset.inputs.wheel, 0);
  assert.equal(reset.navigationFrameIntervals.count, 0);
  assert.equal(clearedLongTaskRecords, 1);
  assert.equal(reset.longTasks.count, 0);
  longTaskCallback({
    getEntries: () => [
      { startTime: 15.999, duration: 99 },
      { startTime: 16, duration: 60 },
      { startTime: 17, duration: 70 },
    ],
  });
  assert.equal(observer.snapshot().longTasks.count, 2);
  assert.equal(observer.snapshot().longTasks.totalMs, 130);
  observer.dispose();
  assert.equal(fixture.Context.prototype.lineTo, fixture.originals.lineTo);
  assert.equal(fixture.OffscreenContext.prototype.stroke, fixture.originals.stroke);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.context.window.__kerfdeskNativeCanvasObservation, undefined);
});

test('endpoint PID guard verifies the browser process and detaches on mismatch', async () => {
  let detached = 0;
  const browser = {
    newBrowserCDPSession: async () => ({
      send: async (method) => {
        assert.equal(method, 'SystemInfo.getProcessInfo');
        return {
          processInfo: [
            { type: 'browser', id: 28220 },
            { type: 'renderer', id: 123 },
          ],
        };
      },
      detach: async () => {
        detached += 1;
      },
    }),
  };
  assert.deepEqual(await verifyBrowserProcess(browser, '28220'), {
    expectedPid: 28220,
    browserPid: 28220,
    matched: true,
  });
  await assert.rejects(verifyBrowserProcess(browser, '25460'), /expected packaged process/);
  await assert.rejects(verifyBrowserProcess(browser, 'garbage'), /PID/);
  assert.equal(detached, 2);
  for (const expectedPid of [undefined, '', '0', '-1', '1.5', 'garbage']) {
    await assert.rejects(runProbe({ 'expected-pid': expectedPid }), /expected-pid/);
  }
});

function panFixture({ overlay = false, pointer = true, paint = true, missing = null } = {}) {
  const rect = { x: 0, y: 0, width: 1200, height: 600 };
  const canvas = { getBoundingClientRect: () => rect };
  let samples = 0;
  const events = [];
  const context = vm.createContext({
    document: {
      visibilityState: 'visible',
      querySelectorAll: () => [],
      querySelector: () => canvas,
      elementFromPoint: () => (overlay ? { overlay: true } : canvas),
    },
  });
  return {
    events,
    page: {
      evaluate: async (source, arg) => {
        if (typeof source === 'function') {
          context.arg = arg;
          return vm.runInContext('(' + source.toString() + ')(arg)', context);
        }
        const after = samples++ > 0;
        return {
          inputs: {
            pointerdown: after && pointer ? 1 : 0,
            pointermove: after && pointer ? 13 : 0,
            pointerup: after && pointer ? 1 : 0,
            ...(missing ? { [missing]: 0 } : {}),
          },
          commands: {
            workspace: { drawImage: after && paint ? 2 : 0 },
            otherCanvas2d: { stroke: 99 },
          },
        };
      },
      mouse: Object.fromEntries(
        ['move', 'down', 'up'].map((name) => [
          name,
          async (...args) => events.push([name, ...args]),
        ]),
      ),
    },
  };
}
test('pan refuses an overlay-covered workspace before sending input', async () => {
  const fixture = panFixture({ overlay: true });
  await assert.rejects(runPan(fixture.page), /workspace|covered|intercept/i);
  assert.equal(fixture.events.length, 0);
});
test('pan needs trusted workspace input and a workspace paint response', async () => {
  for (const options of [
    { pointer: false },
    { paint: false },
    ...['pointerdown', 'pointermove', 'pointerup'].map((missing) => ({ missing })),
  ]) {
    const fixture = panFixture(options);
    await assert.rejects(runPan(fixture.page), /workspace|input|paint/i);
    assert.equal(fixture.events.at(-1)[0], 'up');
  }
  const fixture = panFixture();
  const result = await runPan(fixture.page);
  assert.equal(result.after.inputs.pointerup, 1);
  assert.equal(result.after.commands.workspace.drawImage, 2);
});

test('archive metadata follows the canonical process executable rather than a file alias', async (t) => {
  const root = await mkdtemp(resolve('output-package-alias-test-'));
  const oldAppData = process.env.APPDATA;
  try {
    const build = join(root, 'running-build');
    const aliasDirectory = join(root, 'supplied-alias');
    const isolation = join(root, 'isolated');
    const profile = join(isolation, 'profile');
    const ordinary = join(root, 'roaming');
    await Promise.all(
      [build, aliasDirectory, profile, ordinary].map((directory) =>
        mkdir(directory, { recursive: true }),
      ),
    );
    const executable = join(build, 'KerfDesk.exe');
    const alias = join(aliasDirectory, 'KerfDesk.exe');
    await writeFile(executable, 'fixture');
    try {
      await symlink(executable, alias, 'file');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('File symlinks unavailable on this host');
        return;
      }
      throw error;
    }
    for (const [directory, version] of [
      [build, '1.0.20'],
      [aliasDirectory, '9.9.9'],
    ]) {
      const source = join(directory, 'source');
      await mkdir(source);
      await mkdir(join(directory, 'resources'));
      await writeFile(join(source, 'package.json'), JSON.stringify({ version }));
      await asar.createPackage(source, join(directory, 'resources', 'app.asar'));
    }
    process.env.APPDATA = ordinary;
    const result = join(isolation, 'ready.json');
    await writeFile(
      result,
      JSON.stringify({
        mode: 'interactive-observation',
        isPackaged: true,
        isolated: true,
        readyToShow: true,
        userData: profile,
        sessionData: profile,
      }),
    );
    const identity = {
      pid: 123,
      executable,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      commandLine:
        '"' +
        executable +
        '" --kerfdesk-native-smoke-interactive "--kerfdesk-native-smoke-user-data=' +
        profile +
        '" "--kerfdesk-native-smoke-result=' +
        result +
        '"',
    };
    const owner = await verifyObservationOwner(
      {
        'expected-pid': 123,
        executable: alias,
        'expected-profile': profile,
        'isolation-root': isolation,
      },
      async () => identity,
    );
    const evidence = await packageEvidenceForOwner(owner);
    assert.equal(evidence.executable, await realpath(executable));
    assert.equal(evidence.archive, join(build, 'resources', 'app.asar'));
    assert.equal(evidence.packaged.version, '1.0.20');
    assert.notEqual(evidence.packaged.version, '9.9.9');
  } finally {
    if (oldAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = oldAppData;
    assert.ok(root.startsWith(process.cwd() + sep));
    await rm(root, { recursive: true, force: true });
  }
});
