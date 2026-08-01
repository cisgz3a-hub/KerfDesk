import { expect, test } from '@playwright/test';

const FILLER_CHUNKS = 6_144;
const FILLER_BYTES = 4_096;

test('imports a 24 MiB SVG through the production worker while the UI stays responsive', async ({
  page,
}) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.addInitScript(
    ({ chunks, bytesPerChunk }) => {
      const state = window as Window & {
        __svgHeartbeat?: number;
        __svgHeartbeatAtImport?: number;
        __svgHeartbeatTimer?: number;
        __svgFixtureBytes?: number;
        showOpenFilePicker?: () => Promise<readonly FileSystemFileHandle[]>;
      };
      state.showOpenFilePicker = async () => {
        const filler = `<!--${'x'.repeat(bytesPerChunk - 7)}-->`;
        const parts: BlobPart[] = [
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30">',
          ...Array<string>(chunks).fill(filler),
          '<rect x="5" y="5" width="30" height="20" fill="none" stroke="#ff0000"/>',
          '</svg>',
        ];
        const file = new File(parts, 'large-streamed.svg', { type: 'image/svg+xml' });
        state.__svgFixtureBytes = file.size;
        return [
          { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle,
        ];
      };
      state.__svgHeartbeat = 0;
      state.__svgHeartbeatTimer = window.setInterval(() => {
        state.__svgHeartbeat = (state.__svgHeartbeat ?? 0) + 1;
      }, 25);
    },
    { chunks: FILLER_CHUNKS, bytesPerChunk: FILLER_BYTES },
  );

  await page.goto('/');
  await page.evaluate(() => {
    const state = window as Window & {
      __svgHeartbeat?: number;
      __svgHeartbeatAtImport?: number;
    };
    state.__svgHeartbeat = 0;
    delete state.__svgHeartbeatAtImport;
    const observer = new MutationObserver(() => {
      if (!document.body.textContent?.includes('Objects: 1')) return;
      state.__svgHeartbeatAtImport = state.__svgHeartbeat ?? 0;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Import SVG...' }).click();

  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Layers: 1 (1 output)', { exact: true })).toBeVisible();

  const heartbeatAtImport = await page.evaluate(
    () => (window as Window & { __svgHeartbeatAtImport?: number }).__svgHeartbeatAtImport ?? 0,
  );
  expect(heartbeatAtImport).toBeGreaterThanOrEqual(3);

  const fixtureBytes = await page.evaluate(
    () => (window as Window & { __svgFixtureBytes?: number }).__svgFixtureBytes ?? 0,
  );
  expect(fixtureBytes).toBeGreaterThanOrEqual(FILLER_CHUNKS * FILLER_BYTES);
  expect(workerUrls.some((url) => url.includes('document-import-worker'))).toBe(true);

  await page.evaluate(() => {
    const timer = (window as Window & { __svgHeartbeatTimer?: number }).__svgHeartbeatTimer;
    if (timer !== undefined) window.clearInterval(timer);
  });
});
