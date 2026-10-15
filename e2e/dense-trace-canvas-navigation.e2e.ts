import type { Project, TracedImage } from '../src/core/scene';
import { expect, test, type Page } from './fixtures/kerfdesk-test';

// Large windows expose the clipped sprite's padding budget. Start with completed
// trace geometry: tracing itself has separate real-worker regression coverage.
test.use({ trace: 'off', viewport: { width: 3840, height: 2160 } });
test.skip(process.env['KERFDESK_DENSE_CANVAS_AUDIT'] !== '1', 'Opt-in full-renderer canvas audit');

test('a completed dense trace uses bitmap draws while panning, zooming and moving on a large canvas', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await expect(page.locator('canvas[aria-label$=" workspace"]')).toHaveAttribute(
    'data-workspace-painted',
    'true',
  );
  await installDenseTrace(page);
  const initial = await positionDenseTrace(page);
  expect(initial.contours).toBeGreaterThan(1_000);
  expect(initial.canvasPixels).toBeGreaterThan(1_800_000);
  // Allow the exact zoom sprite to settle before measuring repeated navigation.
  await page.waitForTimeout(600);
  const canvas = page.locator('canvas[aria-label$=" workspace"]');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Workspace canvas missing');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await startPaintProbe(page);
  await page.mouse.down({ button: 'middle' });
  for (let step = 1; step <= 12; step += 1) {
    const before = (await readPaintProbe(page)).imageDraws;
    await page.mouse.move(x + step * 5, y + step * 2);
    await expect.poll(async () => (await readPaintProbe(page)).imageDraws).toBeGreaterThan(before);
  }
  await page.mouse.up({ button: 'middle' });
  const pan = await readPaintProbe(page);
  expect(pan.imageDraws).toBeGreaterThanOrEqual(10);
  // Bed/rulers/selection still draw; the thousands of artwork contours must not.
  expect(pan.lineCommands).toBeLessThan(12_000);

  await startPaintProbe(page);
  for (let step = 0; step < 5; step += 1) {
    const before = (await readPaintProbe(page)).imageDraws;
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await readPaintProbe(page)).imageDraws).toBeGreaterThan(before);
  }
  await page.waitForTimeout(400);
  const zoom = await readPaintProbe(page);
  expect(zoom.imageDraws).toBeGreaterThanOrEqual(4);
  expect(zoom.lineCommands).toBeLessThan(12_000);
  expect(await geometryHash(page)).toBe(initial.geometryHash);
  await positionDenseTrace(page);
  await page.waitForTimeout(400);
  const target = await traceDragTarget(page);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await startPaintProbe(page);
  for (let step = 1; step <= 12; step += 1) {
    const before = (await readPaintProbe(page)).imageDraws;
    await page.mouse.move(target.x + step * 5, target.y + step * 2);
    await expect.poll(async () => (await readPaintProbe(page)).imageDraws).toBeGreaterThan(before);
  }
  await page.mouse.up();
  const move = await readPaintProbe(page);
  expect(move.imageDraws).toBeGreaterThanOrEqual(10);
  expect(move.lineCommands).toBeLessThan(12_000);
  const moved = await traceDragTarget(page);
  expect(
    Math.hypot(moved.transform.x - target.transform.x, moved.transform.y - target.transform.y),
  ).toBeGreaterThan(0.1);
  expect(await geometryHash(page)).toBe(initial.geometryHash);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await traceDragTarget(page)).transform).toEqual(target.transform);
  await info.attach('dense-trace-navigation.json', {
    body: JSON.stringify(
      { initial, pan, zoom, move, before: target.transform, after: moved.transform },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await canvas.screenshot({ path: info.outputPath('dense-trace-after-navigation.png') });
});

async function traceDragTarget(page: Page) {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const uiPath = '/src/ui/state/ui-store.ts';
    const viewPath = '/src/ui/workspace/view-transform.ts';
    const { useStore } = (await import(/* @vite-ignore */ storePath)) as {
      useStore: { getState: () => { project: Project } };
    };
    const { useUiStore } = (await import(/* @vite-ignore */ uiPath)) as {
      useUiStore: { getState: () => { zoomFactor: number; panX: number; panY: number } };
    };
    const { computeView } = (await import(
      /* @vite-ignore */ viewPath
    )) as typeof import('../src/ui/workspace/view-transform');
    const project = useStore.getState().project;
    const trace = project.scene.objects.find((object) => object.kind === 'traced-image');
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label$=" workspace"]');
    if (trace === undefined || canvas === null) throw new Error('Missing trace or canvas');
    const view = computeView(
      canvas.width,
      canvas.height,
      project.device.bedWidth,
      project.device.bedHeight,
      useUiStore.getState(),
    );
    const rect = canvas.getBoundingClientRect();
    // Inside rounded contour 775, away from handles. The fixture uses identity
    // scale/rotation; movement changes only its translation.
    return {
      x: rect.x + (153 + trace.transform.x) * view.scale + view.offsetX,
      y: rect.y + (155 + trace.transform.y) * view.scale + view.offsetY,
      transform: trace.transform,
    };
  });
}

async function installDenseTrace(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const scenePath = '/src/core/scene/index.ts';
    const { useStore } = (await import(/* @vite-ignore */ storePath)) as {
      useStore: { getState: () => { project: Project; setProject: (project: Project) => void } };
    };
    const scene = (await import(
      /* @vite-ignore */ scenePath
    )) as typeof import('../src/core/scene');
    const project = useStore.getState().project;
    // Display stays filled. Disable output so ETA preparation does not compete
    // with the canvas-only diagnostic; this fixture is never sent to hardware.
    const layer = {
      ...scene.createLayer({ id: 'dense-fill', color: '#000000', mode: 'fill' }),
      output: false,
    };
    const trace: TracedImage = {
      kind: 'traced-image',
      id: 'completed-dense-trace',
      source: 'deterministic dense trace fixture',
      operationIds: [layer.id],
      traceMode: 'filled-contours',
      bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
      transform: { ...scene.IDENTITY_TRANSFORM },
      paths: [
        {
          color: layer.color,
          polylines: Array.from({ length: 1500 }, (_, shape) => ({
            closed: true,
            points: Array.from({ length: 120 }, (_, index) => {
              const angle = (2 * Math.PI * index) / 120;
              const radius = 2.2 + 0.4 * Math.sin(angle * 7 + shape);
              return {
                x: 3 + (shape % 50) * 6 + Math.cos(angle) * radius,
                y: 5 + Math.floor(shape / 50) * 10 + Math.sin(angle) * radius,
              };
            }),
          })),
        },
      ],
    };
    useStore.getState().setProject({
      ...project,
      scene: { objects: [trace], layers: [layer] },
    });
  });
}

async function positionDenseTrace(page: Page) {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const uiPath = '/src/ui/state/ui-store.ts';
    const scenePath = '/src/core/scene/index.ts';
    const { useStore } = (await import(/* @vite-ignore */ storePath)) as {
      useStore: { getState: () => { project: Project } };
    };
    const { useUiStore } = (await import(/* @vite-ignore */ uiPath)) as {
      useUiStore: { getState: () => { setView: (zoom: number, x: number, y: number) => void } };
    };
    const { transformedBBox } = (await import(/* @vite-ignore */ scenePath)) as {
      transformedBBox: (object: Project['scene']['objects'][number]) => {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      };
    };
    const project = useStore.getState().project;
    const trace = project.scene.objects.find((object) => object.kind === 'traced-image');
    if (trace?.kind !== 'traced-image') throw new Error('No committed dense trace');
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label$=" workspace"]');
    if (canvas === null) throw new Error('Workspace canvas missing');
    const bounds = transformedBBox(trace);
    useUiStore
      .getState()
      .setView(
        8,
        project.device.bedWidth / 2 - (bounds.minX + bounds.maxX) / 2,
        project.device.bedHeight / 2 - (bounds.minY + bounds.maxY) / 2,
      );
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(trace.paths)),
    );
    return {
      contours: trace.paths.reduce((sum, path) => sum + path.polylines.length, 0),
      canvasPixels: canvas.width * canvas.height,
      geometryHash: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    };
  });
}

async function geometryHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ path)) as {
      useStore: { getState: () => { project: Project } };
    };
    const trace = useStore
      .getState()
      .project.scene.objects.find((object) => object.kind === 'traced-image');
    if (trace?.kind !== 'traced-image') throw new Error('Trace disappeared');
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(trace.paths)),
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  });
}

interface PaintProbe {
  lineCommands: number;
  imageDraws: number;
}
type ProbeWindow = Window & { __denseCanvasPaint?: PaintProbe };

async function startPaintProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as ProbeWindow;
    if (state.__denseCanvasPaint === undefined) {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label$=" workspace"]');
      const context = canvas?.getContext('2d');
      if (context === null || context === undefined) throw new Error('Workspace context missing');
      const lineTo = context.lineTo.bind(context);
      const drawImage = context.drawImage.bind(context);
      context.lineTo = (...args: Parameters<typeof lineTo>) => {
        if (state.__denseCanvasPaint !== undefined) state.__denseCanvasPaint.lineCommands += 1;
        lineTo(...args);
      };
      context.drawImage = ((...args: Parameters<typeof drawImage>) => {
        if (state.__denseCanvasPaint !== undefined) state.__denseCanvasPaint.imageDraws += 1;
        drawImage(...args);
      }) as typeof drawImage;
    }
    state.__denseCanvasPaint = { lineCommands: 0, imageDraws: 0 };
  });
}

async function readPaintProbe(page: Page): Promise<PaintProbe> {
  return page.evaluate(() => {
    const result = (window as ProbeWindow).__denseCanvasPaint;
    if (result === undefined) throw new Error('Paint probe not started');
    return { ...result };
  });
}
