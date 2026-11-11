// Rolling audit v13 Y4-P1-2 and v14 Z1 (ADR-440 Amendments 10 and 11,
// ADR-663 Amendment 6): a calibrated 4K RTSP camera's overlay held the UI
// thread while a job streamed, so Abort waited and a window-route stream
// stopped with the beam lit. Amendment 10's fix still shrank each picture in
// the window, where Chromium does the shrink: 118-243 ms a picture on a
// full-HD window. The camera-moved check on a camera started mid-job, and
// Alt+C, read the whole 4K picture in the window too.
//
// This runs a real job on the paced GRBL stand-in (the window streaming
// route) in a full-HD window, then, as an operator would, starts a 4K stub
// bridge camera on 127.0.0.1 with the overlay shown, lets the moved check run
// against a saved view reference, and presses Alt+C. No UI task may run
// longer than the 50 ms job-time budget, and the window must never shrink a
// camera picture or read a camera-sized picture's pixels itself.
//
// Shared CI runners stream the job itself with tasks of 50-84 ms and no
// camera at all, so the job runs alone first as a control. On CI no task in
// the camera phase may exceed the larger of twice the budget and the
// control's own worst plus 20 ms, and never 120 ms; an in-window 4K shrink
// is 118-243 ms. The two structural checks are the main guard on any runner. Local runs keep the strict budget.

import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import {
  connectMachineAndDismissFirstSetup,
  expectToolbarCommandVisible,
  selectWorkspacePanel,
} from './fixtures/workspace-ui';

const pacedSerialSource = readFileSync(
  fileURLToPath(new URL('./fixtures/paced-grbl-serial.js', import.meta.url)),
  'utf8',
);

const WIDTH = 3840;
const HEIGHT = 2160;
const BUDGET_MS = 50;
const CI_CEILING_MS = 100;
// Never above this, however noisy the control: a stall in the control must not
// let a camera block of the bug's size (118-243 ms) pass.
const CI_MAX_CEILING_MS = 120;
const CONTROL_MARGIN_MS = 20;
const CONTROL_MS = 8_000;
const onCi = ((value) => value !== undefined && value !== '' && value !== 'false' && value !== '0')(
  process.env['CI'],
);

let server: Server | null = null;
let jpeg: Buffer = Buffer.alloc(0);
let partsServed = 0;

test.use({ viewport: { width: 1920, height: 1080 } });

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/frame.jpg') === true && jpeg.length > 0) {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': jpeg.length,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(jpeg);
      return;
    }
    if (req.url?.startsWith('/preview.mjpg') !== true) {
      res.writeHead(404).end();
      return;
    }
    // As the bridge's ffmpeg -f mpjpeg sends an RTSP camera's preview.
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=ffmpeg',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    const timer = setInterval(() => {
      if (jpeg.length === 0) return;
      partsServed += 1;
      res.write(`--ffmpeg\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      res.write(jpeg);
      res.write('\r\n');
    }, 100);
    req.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

interface Probe {
  readonly longTasks: number[];
  readonly uploads: number;
  readonly windowShrinks: number;
  readonly bigPixelReads: number;
  readonly moved: string;
  readonly stillWidth: number | null;
}

// A busy 4K picture, made in the page so no image file is checked in.
async function makeJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height }) => {
      const canvas = new OffscreenCanvas(width, height);
      const g = canvas.getContext('2d');
      if (g === null) throw new Error('no 2d context');
      for (let y = 0; y < height; y += 48) {
        for (let x = 0; x < width; x += 48) {
          g.fillStyle = `rgb(${(x * 7) % 255},${(y * 3) % 255},${((x + y) * 5) % 255})`;
          g.fillRect(x, y, 48, 48);
        }
      }
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    },
    { width: WIDTH, height: HEIGHT },
  );
  return Buffer.from(base64, 'base64');
}

// Twelve rings, a cut job of about 1,200 lines: at 20 lines a second it
// streams for about a minute. The camera is calibrated at the stream's own 4K.
async function installRingsProject(page: Page): Promise<void> {
  await page.evaluate(async (width) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const im = (path: string) => import(/* @vite-ignore */ path) as Promise<any>;
    const scene = await im('/src/core/scene/index.ts');
    const { useStore } = await im('/src/ui/state/store.ts');
    const fixtures = await im('/src/core/camera/model/model-fixtures.ts');
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const ring = (cx: number, cy: number) => ({
      closed: true,
      points: Array.from({ length: 96 }, (_, index) => ({
        x: Math.round((cx + 12 * Math.cos((index / 96) * Math.PI * 2)) * 1000) / 1000,
        y: Math.round((cy + 12 * Math.sin((index / 96) * Math.PI * 2)) * 1000) / 1000,
      })),
    });
    const polylines = Array.from({ length: 12 }, (_, index) =>
      ring(60 + (index % 4) * 30, 60 + Math.floor(index / 4) * 30),
    );
    const layer = {
      ...scene.createLayer({ id: 'cut', color: '#000000', mode: 'line' }),
      speed: 1500,
    };
    const created = scene.createProject();
    useStore.getState().setProject({
      ...created,
      device: {
        ...created.device,
        bedWidth: 400,
        bedHeight: 400,
        homing: { enabled: true, direction: 'front-left' },
        cameraModel: { ...fixtures.savedCameraModel(), lens: fixtures.wideLens(width) },
      },
      jobSetup: {
        ...created.jobSetup,
        placement: { ...created.jobSetup.placement, startFrom: 'current-position' },
      },
      scene: {
        ...created.scene,
        layers: [layer],
        objects: [
          {
            kind: 'imported-svg',
            id: 'rings',
            source: 'rings.svg',
            operationIds: ['cut'],
            bounds: { minX: 40, minY: 40, maxX: 160, maxY: 120 },
            transform: scene.IDENTITY_TRANSFORM,
            paths: [{ color: '#000000', polylines }],
          },
        ],
      },
    });
  }, WIDTH);
}

async function startJob(page: Page): Promise<void> {
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while ((await notifications.count()) > 0) await notifications.first().click();
  await selectWorkspacePanel(page, 'Machine');
  await connectMachineAndDismissFirstSetup(page);
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeEnabled({ timeout: 120_000 });
  await start.click();
  const review = page.getByRole('dialog', { name: 'Review job before starting' });
  await expect(review).toBeVisible({ timeout: 120_000 });
  await review.getByRole('button', { name: 'Start job' }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

// Keep a view reference for the camera, then watch the UI thread, the
// overlay's uploads, and any shrink or full-picture read in the window. Then
// start the camera, as opening the Camera panel mid-job does.
async function startCameraWithProbe(page: Page, port: number): Promise<void> {
  // The test's own setup reads the 4K picture here, before anything is watched.
  await page.evaluate(async (port) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const im = (path: string) => import(/* @vite-ignore */ path) as Promise<any>;
    const { useStore } = await im('/src/ui/state/store.ts');
    const { viewThumbnail } = await im('/src/core/camera/model/view-shift.ts');
    const { saveViewReference } = await im('/src/ui/camera/helpers/view-reference.ts');
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const blob = await (await fetch(`http://127.0.0.1:${port}/frame.jpg`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    if (g === null) throw new Error('no 2d context');
    g.drawImage(bitmap, 0, 0);
    const pixels = g.getImageData(0, 0, bitmap.width, bitmap.height);
    saveViewReference(useStore.getState().project.device.cameraModel, viewThumbnail(pixels));
  }, port);
  await page.evaluate(async (port) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const im = (path: string) => import(/* @vite-ignore */ path) as Promise<any>;
    const { useCameraStore } = await im('/src/ui/state/camera-store.ts');
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const probe = window as unknown as {
      zz: { longTasks: number[]; uploads: number; windowShrinks: number; bigPixelReads: number };
    };
    probe.zz = { longTasks: [], uploads: 0, windowShrinks: 0, bigPixelReads: 0 };
    const upload = WebGL2RenderingContext.prototype.texImage2D;
    WebGL2RenderingContext.prototype.texImage2D = function (this: unknown, ...args: unknown[]) {
      if (args.length === 6) probe.zz.uploads += 1;
      return (upload as (...rest: unknown[]) => void).apply(this, args);
    } as typeof upload;
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((...args: unknown[]) => {
      const options = args.find(
        (arg) => typeof arg === 'object' && arg !== null && 'resizeWidth' in arg,
      );
      if (options !== undefined) probe.zz.windowShrinks += 1;
      return (decode as (...rest: unknown[]) => Promise<ImageBitmap>)(...args);
    }) as typeof window.createImageBitmap;
    for (const proto of [
      CanvasRenderingContext2D.prototype,
      OffscreenCanvasRenderingContext2D.prototype,
    ]) {
      const read = proto.getImageData;
      proto.getImageData = function (this: unknown, ...args: unknown[]) {
        if (Number(args[2]) * Number(args[3]) >= 1_000_000) probe.zz.bigPixelReads += 1;
        return (read as (...rest: unknown[]) => ImageData).apply(this, args);
      } as typeof read;
    }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.zz.longTasks.push(entry.duration);
    }).observe({ type: 'longtask' });

    const source = {
      kind: 'machine-rtsp',
      frameUrl: `http://127.0.0.1:${port}/frame.jpg`,
      previewUrl: `http://127.0.0.1:${port}/preview.mjpg`,
      sourceId: 'rtsp://127.0.0.1:8554/stub',
      liveness: { kind: 'unmonitored', advisory: 'stub' },
    };
    useCameraStore.setState({ overlayVisible: true, sourceState: { kind: 'live', source } });
  }, port);
}

// The job alone for a while: the longest tasks the runner gives it without a camera.
async function jobAlone(page: Page): Promise<number[]> {
  await page.evaluate(() => {
    const control = window as unknown as { zzControl: number[] };
    control.zzControl = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) control.zzControl.push(entry.duration);
    });
    observer.observe({ type: 'longtask' });
    (window as unknown as { zzControlStop: () => void }).zzControlStop = () =>
      observer.disconnect();
  });
  await page.waitForTimeout(CONTROL_MS);
  return page.evaluate(() => {
    (window as unknown as { zzControlStop: () => void }).zzControlStop();
    return (window as unknown as { zzControl: number[] }).zzControl.map(Math.round);
  });
}

async function readProbe(page: Page): Promise<Probe> {
  return page.evaluate(async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const im = (path: string) => import(/* @vite-ignore */ path) as Promise<any>;
    const { useCameraStore } = await im('/src/ui/state/camera-store.ts');
    const { useCameraMovedStore } = await im('/src/ui/camera/helpers/moved-check.ts');
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const { zz } = window as unknown as {
      zz: { longTasks: number[]; uploads: number; windowShrinks: number; bigPixelReads: number };
    };
    const still = useCameraStore.getState().overlayStill as { width: number } | null;
    return {
      ...zz,
      moved: String(useCameraMovedStore.getState().state.kind),
      stillWidth: still?.width ?? null,
    };
  });
}

test('a 4K bridge camera started mid-job, its overlay and Alt+C keep every UI task under 50 ms', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.addInitScript({ content: 'window.__PACED_GRBL_CONFIG__ = { blocksPerSecond: 20 };' });
  await page.addInitScript({ content: pacedSerialSource });
  await page.goto('/');
  await expectToolbarCommandVisible(page, 'Open...', { timeout: 180_000 });
  jpeg = await makeJpeg(page);
  const port = (server?.address() as AddressInfo).port;
  await installRingsProject(page);
  await startJob(page);
  const control = await jobAlone(page);

  // The camera starts mid-job; its moved check runs three seconds later.
  await startCameraWithProbe(page, port);
  await expect.poll(() => partsServed, { timeout: 60_000 }).toBeGreaterThan(20);
  await expect.poll(async () => (await readProbe(page)).moved, { timeout: 30_000 }).toBe('steady');
  await page.waitForTimeout(6_000);
  // Alt+C, LightBurn's Update Overlay, during the job.
  await page.keyboard.press('Alt+c');
  await expect
    .poll(async () => (await readProbe(page)).stillWidth, { timeout: 30_000 })
    .toBe(WIDTH);
  await page.waitForTimeout(3_000);
  // Still a job: everything above was measured while it streamed.
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  const probe = await readProbe(page);
  test.info().annotations.push({
    type: 'measured',
    description: JSON.stringify({ ...probe, partsServed, control }),
  });
  // The overlay drew the stream at the job's pace (a picture each 500 ms), and the still.
  expect(probe.uploads).toBeGreaterThan(8);
  expect(probe.uploads).toBeLessThanOrEqual(partsServed + 50);
  // The window neither shrank a picture nor read a 4K picture's pixels.
  expect(probe.windowShrinks).toBe(0);
  expect(probe.bigPixelReads).toBe(0);
  const controlWorst = control.reduce((worst, ms) => Math.max(worst, ms), 0);
  const ceiling = onCi
    ? Math.min(Math.max(CI_CEILING_MS, controlWorst + CONTROL_MARGIN_MS), CI_MAX_CEILING_MS)
    : BUDGET_MS;
  expect(
    probe.longTasks.filter((ms) => ms > ceiling),
    JSON.stringify({ camera: probe.longTasks.map(Math.round), jobAlone: control, ceiling }),
  ).toEqual([]);
});
