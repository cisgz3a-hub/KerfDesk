import { Buffer } from 'node:buffer';
import { test, expect, type Page } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner', { name: 'Toolbar' })).toContainText('KerfDesk');
});

test('opens and saves a deterministic project through the real file workflow', async ({
  page,
  kerfdesk,
}) => {
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);

  await page.getByRole('button', { name: 'Save As...' }).click();
  await expect
    .poll(async () => (await kerfdesk.events()).map((event) => event.kind))
    .toContain('file-saved');
  expect(Object.keys(await kerfdesk.savedFiles())).toContain('project-basic.lf2');
});

test('connects to deterministic GRBL serial and opens the deterministic USB camera', async ({
  page,
  kerfdesk,
}) => {
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect
    .poll(async () => (await kerfdesk.events()).map((event) => event.kind))
    .toContain('serial-open');
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Camera' }).click();
  await page.getByRole('button', { name: 'Start USB camera' }).click();

  await expect
    .poll(async () => (await kerfdesk.events()).map((event) => event.kind))
    .toEqual(expect.arrayContaining(['serial-open', 'camera-open']));
  const serialOpen = (await kerfdesk.events()).find((event) => event.kind === 'serial-open');
  expect(serialOpen?.['baudRate']).toBe(115200);
});

test('connects an RTSP camera through the loopback bridge and captures readable pixels', async ({
  page,
}) => {
  const bridge = await installRtspBridgeRoutes(page);
  await page.getByRole('button', { name: 'Camera' }).click();

  await page.getByText(/^RTSP camera/).click();
  await page.getByRole('textbox', { name: 'RTSP camera URL' }).fill('rtsp://192.168.10.1:8554/');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Connected', exact: true })).toBeVisible();
  await expect(page.getByAltText('Machine camera stream')).toHaveAttribute(
    'src',
    'http://127.0.0.1:51731/stream.mjpg?camera=e2e',
  );
  await expect(page.getByText(/Use a camera/)).toContainText('Use a camera');

  await page.getByText('Diagnostics', { exact: true }).click();
  await expect(page.getByText(/Bridge: running/)).toContainText('frame proxy yes');
  await expect(page.getByText('Source: RTSP camera (live)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test capture' }).click();
  await expect(page.getByText(/Captured 1.1.*pixels readable/)).toBeVisible();

  await page.getByRole('button', { name: 'Close camera panel' }).click();
  bridge.setProbeAvailable(false);
  await page.getByRole('button', { name: 'Camera' }).click();
  await page.getByText(/^RTSP camera/).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('E2E RTSP camera unavailable.', { exact: true })).toBeVisible();
});

async function installRtspBridgeRoutes(
  page: Page,
): Promise<{ readonly setProbeAvailable: (available: boolean) => void }> {
  let probeAvailable = true;
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await page.route('http://127.0.0.1:51731/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === '/health') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ kind: 'ok', ffmpegAvailable: true, frameProxy: true }),
      });
      return;
    }
    if (requestUrl.pathname === '/discover') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ kind: 'ok', found: null }),
      });
      return;
    }
    if (requestUrl.pathname === '/probe') {
      if (!probeAvailable) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ kind: 'unavailable', reason: 'E2E RTSP camera unavailable.' }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          kind: 'ok',
          url: requestUrl.searchParams.get('url'),
          codec: 'h264',
          ffmpegAvailable: true,
          previewUrl: 'http://127.0.0.1:51731/stream.mjpg?camera=e2e',
        }),
      });
      return;
    }
    if (requestUrl.pathname === '/stream.mjpg' || requestUrl.pathname === '/frame.jpg') {
      await route.fulfill({ contentType: 'image/png', body: pixel });
      return;
    }
    await route.abort('failed');
  });
  return { setProbeAvailable: (available) => (probeAvailable = available) };
}
