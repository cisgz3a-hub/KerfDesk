// Rolling audit v13 Y4-P1-2 (ADR-440 Amendment 10): a calibrated 4K RTSP
// camera's live overlay held the UI thread 97 % of the time, uploading the
// whole MJPEG picture to WebGL about 30 times a second, so Abort waited and a
// window-route stream stalled with the beam lit. A stub bridge on 127.0.0.1
// serves 4K MJPEG parts at 10 a second; with the overlay drawing them, no
// task on the UI thread may run longer than the 50 ms job-time budget.

import { Buffer } from 'node:buffer';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from './fixtures/kerfdesk-test';

const WIDTH = 3840;
const HEIGHT = 2160;

let server: Server | null = null;
let jpeg = Buffer.alloc(0);
let partsServed = 0;

test.beforeAll(async () => {
  server = createServer((req, res) => {
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

test('a 4K RTSP camera on the overlay keeps every UI task under 50 ms', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await expect(page.getByRole('banner', { name: 'Toolbar', exact: true })).toBeVisible({
    timeout: 180_000,
  });
  // A busy 4K picture, made in the page so no image file is checked in.
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

  await page.evaluate(
    async ({ port, width }) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const im = (path: string) => import(/* @vite-ignore */ path) as Promise<any>;
      const { useStore } = await im('/src/ui/state/store.ts');
      const { useCameraStore } = await im('/src/ui/state/camera-store.ts');
      const fixtures = await im('/src/core/camera/model/model-fixtures.ts');
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const source = {
        kind: 'machine-rtsp',
        frameUrl: `http://127.0.0.1:${port}/frame.jpg`,
        previewUrl: `http://127.0.0.1:${port}/preview.mjpg`,
        sourceId: 'rtsp://127.0.0.1:8554/stub',
        liveness: { kind: 'unmonitored', advisory: 'stub' },
      };
      // Calibrated at the stream's own 4K size, so the picture is placed as is.
      const model = { ...fixtures.savedCameraModel(), lens: fixtures.wideLens(width) };
      const project = useStore.getState().project;
      useStore.setState({
        project: {
          ...project,
          device: { ...project.device, bedWidth: 400, bedHeight: 400, cameraModel: model },
        },
      });
      useCameraStore.setState({ overlayVisible: true, sourceState: { kind: 'live', source } });
      // Count the overlay's uploads, so a quiet thread cannot mean nothing drew.
      const counter = window as unknown as { zzUploads: number; zzLongTasks: number[] };
      counter.zzUploads = 0;
      const upload = WebGL2RenderingContext.prototype.texImage2D;
      WebGL2RenderingContext.prototype.texImage2D = function (
        this: WebGL2RenderingContext,
        ...args: unknown[]
      ) {
        if (args.length === 6) counter.zzUploads += 1;
        return (upload as (...rest: unknown[]) => void).apply(this, args);
      } as typeof upload;
      counter.zzLongTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as unknown as { zzLongTasks: number[] }).zzLongTasks.push(entry.duration);
        }
      }).observe({ type: 'longtask' });
    },
    { port, width: WIDTH },
  );

  // Let the stream run: about 80 4K parts reach the page.
  await expect.poll(() => partsServed, { timeout: 60_000 }).toBeGreaterThan(20);
  const startParts = partsServed;
  await page.waitForTimeout(8_000);
  expect(partsServed - startParts).toBeGreaterThan(40);
  const { longTasks, uploads } = await page.evaluate(() => {
    const counter = window as unknown as { zzUploads: number; zzLongTasks: number[] };
    return { longTasks: counter.zzLongTasks, uploads: counter.zzUploads };
  });
  test.info().annotations.push({
    type: 'measured',
    description: JSON.stringify({ uploads, partsServed, longTasks }),
  });
  // The overlay drew the stream: at most one upload per picture (10 a second, fewer when busy).
  expect(uploads).toBeGreaterThan(10);
  expect(uploads).toBeLessThanOrEqual(partsServed);
  expect(
    longTasks.filter((ms) => ms > 50),
    JSON.stringify(longTasks),
  ).toEqual([]);
});
