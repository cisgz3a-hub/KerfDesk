import { Buffer } from 'node:buffer';
import { expect, test, type Page } from './fixtures/kerfdesk-test';

test('RTSP bridge failure requires explicit reconnect even when the image never errors', async ({
  page,
}) => {
  const bridge = await installControlledRtspBridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Camera' }).click();
  await page.getByText(/^RTSP camera/).click();
  await page.getByRole('textbox', { name: 'RTSP camera URL' }).fill('rtsp://192.168.10.1:8554/');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(page.getByAltText('Machine camera stream')).toBeVisible();
  await expect.poll(bridge.statusHits).toBeGreaterThan(0);

  bridge.failStream();

  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await expect(page.getByText(/RTSP preview stopped/)).toBeVisible();
  expect(bridge.probeHits()).toBe(1);

  bridge.restoreStream();
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  expect(bridge.probeHits()).toBe(2);
});

async function installControlledRtspBridge(page: Page): Promise<{
  readonly failStream: () => void;
  readonly restoreStream: () => void;
  readonly probeHits: () => number;
  readonly statusHits: () => number;
}> {
  let failed = false;
  let probes = 0;
  let statuses = 0;
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await page.route('http://127.0.0.1:51731/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
    if (requestUrl.pathname === '/health') {
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ kind: 'ok', ffmpegAvailable: true, frameProxy: true }),
      });
      return;
    }
    if (requestUrl.pathname === '/discover') {
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ kind: 'ok', found: null }),
      });
      return;
    }
    if (requestUrl.pathname === '/probe') {
      probes += 1;
      const streamSessionId = `e2e-session-${probes}`;
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          kind: 'ok',
          url: requestUrl.searchParams.get('url'),
          codec: 'h264',
          ffmpegAvailable: true,
          previewUrl: `http://127.0.0.1:51731/stream.mjpg?session=${streamSessionId}`,
          streamSessionId,
        }),
      });
      return;
    }
    if (requestUrl.pathname === '/stream-status') {
      statuses += 1;
      await route.fulfill({
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify(
          failed ? { kind: 'failed', reason: 'Synthetic FFmpeg stop.' } : { kind: 'live' },
        ),
      });
      return;
    }
    if (requestUrl.pathname === '/stream.mjpg' || requestUrl.pathname === '/frame.jpg') {
      await route.fulfill({ contentType: 'image/png', headers: corsHeaders, body: pixel });
      return;
    }
    await route.abort('failed');
  });
  return {
    failStream: () => (failed = true),
    restoreStream: () => (failed = false),
    probeHits: () => probes,
    statusHits: () => statuses,
  };
}
