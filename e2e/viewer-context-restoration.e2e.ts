import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Viewer3dSceneHandle } from '../src/ui/viewer3d/viewer3d-scene';

type SceneModule = typeof import('../src/ui/viewer3d/viewer3d-scene');
type GcodeModule = typeof import('../src/core/gcode-view/gcode-render-model');
type LookModule = typeof import('../src/ui/viewer3d/viewer3d-look');

interface PixelSample {
  pixel: [number, number];
  rgba: number[];
}
interface FrameReceipt {
  source: 'scheduled' | 'capture';
  canvas: number[];
  pixels: PixelSample[];
  data: string;
  glError: number;
  contextLost: boolean;
}
interface ContextEvent {
  type: string;
  defaultPrevented: boolean;
}
interface RestoreCycle {
  lost: ContextEvent;
  restored: ContextEvent;
  wasLost: boolean;
  restoreError: number;
  contextIdentityRetained: boolean;
  requestStacks: string[];
  automatic: FrameReceipt | null;
  captured: FrameReceipt;
}
interface BrowserReceipt {
  input: string;
  theme: string;
  before: FrameReceipt;
  preparedStudio: FrameReceipt | null;
  cycles: RestoreCycle[];
  cleanup: {
    wasLost: boolean;
    restored: ContextEvent;
    contextIdentityRetained: boolean;
    renderRequests: number;
    renderedFrames: number;
    remainingLabelLayers: number;
  };
}

// Serialized into the browser: every scene, camera and scheduler is production code.
async function productionContextReceipt(options: {
  theme: string;
  prepareStudio: boolean;
}): Promise<BrowserReceipt> {
  const scenePath = '/src/ui/viewer3d/viewer3d-scene.ts';
  const gcodePath = '/src/core/gcode-view/gcode-render-model.ts';
  const lookPath = '/src/ui/viewer3d/viewer3d-look.ts';
  const { createViewer3dScene } = (await import(/* @vite-ignore */ scenePath)) as SceneModule;
  const { buildGcodeRenderModel } = (await import(/* @vite-ignore */ gcodePath)) as GcodeModule;
  const { CLASSIC_STAGE } = (await import(/* @vite-ignore */ lookPath)) as LookModule;
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  canvas.style.cssText = 'width:800px;height:600px;display:block';
  canvas.style.setProperty('--lf-viewer3d-bg', options.theme);
  globalThis.document.body.append(canvas);
  const originalRaf = globalThis.requestAnimationFrame;
  const frames: FrameReceipt[] = [];
  const requests: string[] = [];
  let colourClears = 0;
  let recordFrame: (() => void) | null = null;
  let handle: Viewer3dSceneHandle | null = null;
  let restoreClear: (() => void) | null = null;
  // Read immediately after an actual production rAF callback, before composite
  // discards the non-preserved drawing buffer. This wrapper never requests a frame.
  globalThis.requestAnimationFrame = (callback) => {
    requests.push(new Error().stack ?? '');
    return originalRaf.call(globalThis, (time) => {
      const before = colourClears;
      callback(time);
      if (colourClears > before) recordFrame?.();
    });
  };
  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => originalRaf.call(globalThis, () => resolve()));
  const settle = async (): Promise<void> => {
    let quiet = 0;
    for (let attempt = 0; attempt < 120 && quiet < 3; attempt += 1) {
      const before = requests.length + colourClears;
      await nextFrame();
      quiet = before === requests.length + colourClears ? quiet + 1 : 0;
    }
    if (quiet < 3) throw new Error('Production scene did not settle before the loss control');
  };
  const waitForEvent = (type: string): Promise<ContextEvent> =>
    new Promise((resolve, reject) => {
      const listener = (event: Event): void => {
        globalThis.clearTimeout(timer);
        resolve({ type: event.type, defaultPrevented: event.defaultPrevented });
      };
      const timer = globalThis.setTimeout(() => {
        canvas.removeEventListener(type, listener);
        reject(new Error(type + ' timed out'));
      }, 10_000);
      canvas.addEventListener(type, listener, { once: true });
    });
  try {
    const result = await createViewer3dScene(canvas);
    if (result.kind !== 'ok') throw new Error(result.reason);
    handle = result.handle;
    const current = handle;
    const gl = canvas.getContext('webgl2');
    if (gl === null) throw new Error('Production viewer did not create WebGL2');
    const extension = gl.getExtension('WEBGL_lose_context');
    if (extension === null) throw new Error('Real context-loss extension is unavailable');
    const originalClear = gl.clear;
    gl.clear = (mask) => {
      originalClear.call(gl, mask);
      if ((mask & gl.COLOR_BUFFER_BIT) !== 0) colourClears += 1;
    };
    restoreClear = () => {
      gl.clear = originalClear;
    };
    const readFrame = (source: FrameReceipt['source'], data: string): FrameReceipt => ({
      source,
      canvas: [canvas.width, canvas.height],
      // Keep the coordinator's five exact top-left image coordinates.
      pixels: (
        [
          [1, 1],
          [10, 10],
          [20, 10],
          [1, canvas.height - 2],
          [10, canvas.height - 10],
        ] as [number, number][]
      ).map(([x, y]) => {
        const rgba = new Uint8Array(4);
        gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        return { pixel: [x, y], rgba: [...rgba] };
      }),
      data,
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
    });
    recordFrame = () => {
      if (!gl.isContextLost()) frames.push(readFrame('scheduled', canvas.toDataURL('image/png')));
    };
    const capture = (): FrameReceipt => readFrame('capture', current.captureImage());
    const input = 'G21 G90\nM3 S500\nG1 X100 Z1 F600\nG1 X0 Z0\nM5\nG0 Y10';
    const parsed = buildGcodeRenderModel(input, {
      machineKind: 'laser',
      retainPreciseSegmentLengths: true,
    });
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    current.setSegments(parsed.model);
    current.setStage(CLASSIC_STAGE);
    current.setView('top');
    current.fitView();
    current.setPlayhead({ segmentIndex: 1, point: { x: 50, y: 0, z: 0.5 } });
    await settle();
    const before = frames.at(-1);
    if (before === undefined) throw new Error('Initial production frame was not observed');
    let preparedStudio: FrameReceipt | null = null;
    if (options.prepareStudio) {
      current.setStage({ ...CLASSIC_STAGE, look: 'studio' });
      await current.prepareToShow();
      await settle();
      preparedStudio = capture();
      await settle();
    }
    const cycles: RestoreCycle[] = [];
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await settle();
      const lostPromise = waitForEvent('webglcontextlost');
      extension.loseContext();
      const lost = await lostPromise;
      const wasLost = gl.isContextLost();
      gl.getError(); // Consume the expected CONTEXT_LOST_WEBGL notification.
      if (options.prepareStudio && cycle === 0) current.setStage(CLASSIC_STAGE);
      // Drain any stage/camera request made while lost, so it cannot masquerade
      // as the restoration listener's automatic render request.
      await settle();
      const firstFrame = frames.length;
      const firstRequest = requests.length;
      const restoredPromise = waitForEvent('webglcontextrestored');
      extension.restoreContext();
      const restoreError = gl.getError();
      const restored = await restoredPromise;
      for (let frame = 0; frame < 12; frame += 1) await nextFrame();
      // Freeze automatic evidence before captureImage schedules or draws anything.
      const automatic = frames[firstFrame] ?? null;
      const requestStacks = requests.slice(firstRequest);
      const contextIdentityRetained = gl === canvas.getContext('webgl2');
      const captured = capture();
      cycles.push({
        lost,
        restored,
        wasLost,
        restoreError,
        contextIdentityRetained,
        requestStacks,
        automatic,
        captured,
      });
    }
    await settle();
    current.dispose();
    handle = null;
    const firstRequest = requests.length;
    const firstFrame = frames.length;
    // A connected canvas retains its context on disposal. Only this deliberate
    // post-disposal control grants restoration; Three's owner has been removed.
    canvas.addEventListener('webglcontextlost', (event) => event.preventDefault(), { once: true });
    const lostPromise = waitForEvent('webglcontextlost');
    extension.loseContext();
    await lostPromise;
    const wasLost = gl.isContextLost();
    gl.getError();
    await nextFrame();
    const restoredPromise = waitForEvent('webglcontextrestored');
    extension.restoreContext();
    const restored = await restoredPromise;
    for (let frame = 0; frame < 12; frame += 1) await nextFrame();
    return {
      input,
      theme: options.theme,
      before,
      preparedStudio,
      cycles,
      cleanup: {
        wasLost,
        restored,
        contextIdentityRetained: gl === canvas.getContext('webgl2'),
        renderRequests: requests.length - firstRequest,
        renderedFrames: frames.length - firstFrame,
        remainingLabelLayers: globalThis.document.querySelectorAll('.viewer3d-label-layer').length,
      },
    };
  } finally {
    handle?.dispose();
    globalThis.requestAnimationFrame = originalRaf;
    restoreClear?.();
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }
}

test.use({
  viewport: { width: 1000, height: 760 },
  deviceScaleFactor: 1,
  contextOptions: { reducedMotion: 'reduce' },
});

for (const scenario of [
  { name: 'classic-default', theme: '#1c1f24', expected: [28, 31, 36, 255], prepareStudio: false },
  {
    name: 'classic-current-theme',
    theme: '#2a3440',
    expected: [42, 52, 64, 255],
    prepareStudio: false,
  },
  {
    name: 'prepared-studio-to-classic',
    theme: '#6c5140',
    expected: [108, 81, 64, 255],
    prepareStudio: true,
  },
]) {
  test(
    scenario.name + ' restores the production background and redraws automatically',
    async ({ page }, info) => {
      const browserErrors: string[] = [];
      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      // Keep unrelated app initialization out of this real production scene test.
      await page.route('**/viewer-context-restoration.html', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><body></body></html>',
        }),
      );
      await page.goto('/viewer-context-restoration.html');
      const result = await page.evaluate(productionContextReceipt, scenario);
      const receiptPath = info.outputPath('production-context-pixels.json');
      await writeFile(
        receiptPath,
        JSON.stringify(result, (key, value: unknown) => (key === 'data' ? undefined : value), 2),
      );
      await info.attach('production-context-pixels', {
        path: receiptPath,
        contentType: 'application/json',
      });
      const images = new Map<string, FrameReceipt>([['before', result.before]]);
      if (result.preparedStudio !== null) images.set('prepared-studio', result.preparedStudio);
      for (const [index, cycle] of result.cycles.entries()) {
        if (cycle.automatic !== null) images.set('automatic-' + index, cycle.automatic);
        images.set('captured-' + index, cycle.captured);
      }
      for (const [name, frame] of images) {
        const path = info.outputPath(name + '.png');
        await writeFile(path, Buffer.from(frame.data.slice(frame.data.indexOf(',') + 1), 'base64'));
        await info.attach(name, { path, contentType: 'image/png' });
      }
      expect(browserErrors).toEqual([]);
      expect(result.before.canvas).toEqual([800, 600]);
      expect(result.before.pixels.map((pixel) => pixel.pixel)).toEqual([
        [1, 1],
        [10, 10],
        [20, 10],
        [1, 598],
        [10, 590],
      ]);
      expect(result.before.pixels.map((pixel) => pixel.rgba)).toEqual(
        Array.from({ length: 5 }, () => scenario.expected),
      );
      if (scenario.prepareStudio) {
        expect(result.preparedStudio).not.toBeNull();
        expect(result.preparedStudio?.pixels.map((pixel) => pixel.rgba)).not.toEqual(
          result.before.pixels.map((pixel) => pixel.rgba),
        );
      }
      expect(result.cycles).toHaveLength(2);
      for (const cycle of result.cycles) {
        expect(cycle.wasLost).toBe(true);
        expect(cycle.lost.defaultPrevented).toBe(true);
        expect(cycle.restored.type).toBe('webglcontextrestored');
        expect(cycle.restoreError).toBe(0);
        expect(cycle.contextIdentityRetained).toBe(true);
        expect(
          cycle.requestStacks.some(
            (stack) =>
              stack.includes('viewer3d-context.ts') &&
              stack.includes('create-viewer3d-render-scheduler.ts'),
          ),
        ).toBe(true);
        expect(
          cycle.automatic,
          'production restoration must draw before explicit capture',
        ).not.toBeNull();
        for (const frame of [cycle.automatic, cycle.captured]) {
          expect(frame?.glError).toBe(0);
          expect(frame?.contextLost).toBe(false);
          expect(frame?.pixels).toEqual(result.before.pixels);
        }
        expect(cycle.automatic?.source).toBe('scheduled');
      }
      expect(result.cleanup.wasLost).toBe(true);
      expect(result.cleanup.restored.type).toBe('webglcontextrestored');
      expect(result.cleanup.contextIdentityRetained).toBe(true);
      expect(result.cleanup.renderRequests).toBe(0);
      expect(result.cleanup.renderedFrames).toBe(0);
      expect(result.cleanup.remainingLabelLayers).toBe(0);
    },
  );
}
