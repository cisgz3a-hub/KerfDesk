// Rolling audit v13 Y4-P1-1 / Y4-P2-1 (ADR-490 Amendment 2): job watch and
// remote stills read, flattened and encoded 4K camera frames on the UI
// thread, 60-300 ms a picture, and an Abort pressed meanwhile waited. A stub
// camera on 127.0.0.1 serves a 4K JPEG; the page runs the real picture
// worker path (the timelapse's flattened frame and a plain still) in a loop
// while key presses arrive, as an Abort would. Every key handler must start
// within the 50 ms job-time budget, with no long task. The old in-window
// path runs as the control, so the guard cannot pass by measuring nothing.

import { Buffer } from 'node:buffer';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from './fixtures/kerfdesk-test';

const WIDTH = 3840;
const HEIGHT = 2160;
let server: Server | null = null;
let jpeg = Buffer.alloc(0);

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/frame.jpg') !== true || jpeg.length === 0) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': jpeg.length,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(jpeg);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

interface Measured {
  readonly longTasks: number[];
  readonly keyDelays: number[];
  readonly pictures: number;
}

// Runs `path` in a loop in the page for about 4 s while keys are pressed.
async function measure(page: Page, path: 'worker' | 'window', port: number): Promise<Measured> {
  await page.evaluate(
    async ({ path, port, width }) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const im = (p: string) => import(/* @vite-ignore */ p) as Promise<any>;
      const client = (
        await im('/src/ui/camera/picture-worker/camera-picture-client.ts')
      ).pictureClient();
      const watch = await im('/src/ui/camera/job-watch/job-watch-camera.ts');
      const frames = await im('/src/ui/camera/frame-source.ts');
      const fixtures = await im('/src/core/camera/model/model-fixtures.ts');
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const source = {
        kind: 'machine-jpeg',
        frameUrl: `http://127.0.0.1:${port}/frame.jpg`,
        cameraUrl: `http://127.0.0.1:${port}/frame.jpg`,
      };
      const camera = {
        source,
        fixedModel: { ...fixtures.savedCameraModel(), lens: fixtures.wideLens(width) },
        surfaceHeightMm: 3,
        heightAreas: [],
        taken: {},
      };
      const region = { x: 0, y: 0, width: 400, height: 400 };
      const state = window as unknown as {
        zz: { longTasks: number[]; keyDelays: number[]; pictures: number; running: boolean };
      };
      state.zz = { longTasks: [], keyDelays: [], pictures: 0, running: true };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.zz.longTasks.push(entry.duration);
      }).observe({ type: 'longtask' });
      window.addEventListener(
        'keydown',
        (event) => state.zz.keyDelays.push(performance.now() - event.timeStamp),
        { capture: true },
      );
      const one = async (): Promise<void> => {
        if (path === 'worker') {
          const bitmap = await client.capture(source);
          const spec = watch.flattenSpecFor(camera, bitmap.width, bitmap.height, region, 2.5);
          await client.run({
            op: 'jpeg',
            frame: bitmap,
            flatten: spec.spec,
            maxSidePx: 1280,
            quality: 0.82,
          });
          const still = await client.capture(source);
          await client.run({ op: 'jpeg', frame: still, maxSidePx: 1024, quality: 0.8 });
        } else {
          const frame = await frames.captureSourceFrame(source);
          const flat = watch.flattenedPicture(camera, frame, region, 2.5);
          await watch.encodeJpegPicture(flat.image, 1280);
          await watch.encodeJpegPicture(frame, 1024);
        }
        state.zz.pictures += 2;
      };
      void (async () => {
        const until = performance.now() + 4000;
        while (performance.now() < until) await one();
        state.zz.running = false;
      })();
    },
    { path, port, width: WIDTH },
  );
  // An Abort could come at any moment: press a key every 130 ms meanwhile.
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Shift');
    await page.waitForTimeout(130);
  }
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { zz: { running: boolean } }).zz.running),
      {
        timeout: 60_000,
      },
    )
    .toBe(false);
  return page.evaluate(() => {
    const { longTasks, keyDelays, pictures } = (window as unknown as { zz: Measured }).zz;
    return { longTasks, keyDelays, pictures };
  });
}

test('4K job-watch pictures and remote stills keep Abort within the 50 ms budget', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await expect(page.getByRole('banner', { name: 'Toolbar', exact: true })).toBeVisible({
    timeout: 180_000,
  });
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
  jpeg = Buffer.from(base64, 'base64');
  const port = (server?.address() as AddressInfo).port;

  const window_ = await measure(page, 'window', port);
  const worker = await measure(page, 'worker', port);
  test.info().annotations.push({
    type: 'measured',
    description: JSON.stringify({ window: window_, worker }),
  });
  // The control: the old in-window path holds the thread past the budget.
  expect(Math.max(...window_.longTasks, 0)).toBeGreaterThan(50);
  // The worker path: pictures made, keys handled promptly, no long task.
  expect(worker.pictures).toBeGreaterThan(4);
  expect(worker.keyDelays.length).toBeGreaterThan(10);
  expect(Math.max(...worker.keyDelays), JSON.stringify(worker.keyDelays)).toBeLessThan(50);
  expect(
    worker.longTasks.filter((ms) => ms > 50),
    JSON.stringify(worker.longTasks),
  ).toEqual([]);
});
