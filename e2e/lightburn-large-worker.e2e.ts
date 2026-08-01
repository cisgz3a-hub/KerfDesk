import { expect, test } from '@playwright/test';

const FILLER_CHUNKS = 6_144;
const FILLER_BYTES = 4_096;

test('imports a 24 MiB LightBurn project through the production worker', async ({ page }) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.addInitScript(
    ({ chunks, bytesPerChunk }) => {
      const state = window as Window & {
        __lightBurnHeartbeat?: number;
        __lightBurnHeartbeatAtImport?: number;
        __lightBurnHeartbeatTimer?: number;
        __lightBurnFixtureBytes?: number;
        showOpenFilePicker?: () => Promise<readonly FileSystemFileHandle[]>;
      };
      state.showOpenFilePicker = async () => {
        const filler = `<!--${'x'.repeat(bytesPerChunk - 7)}-->`;
        const parts: BlobPart[] = [
          '<LightBurnProject AppVersion="1.7">',
          ...Array<string>(chunks).fill(filler),
          '<Shape Type="Rect" CutIndex="2" W="10" H="6">',
          '<XForm>1 0 0 1 5 5</XForm>',
          '</Shape></LightBurnProject>',
        ];
        const file = new File(parts, 'large-streamed.lbrn2', { type: 'text/xml' });
        state.__lightBurnFixtureBytes = file.size;
        return [
          { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle,
        ];
      };
      state.__lightBurnHeartbeat = 0;
      state.__lightBurnHeartbeatTimer = window.setInterval(() => {
        state.__lightBurnHeartbeat = (state.__lightBurnHeartbeat ?? 0) + 1;
      }, 25);
    },
    { chunks: FILLER_CHUNKS, bytesPerChunk: FILLER_BYTES },
  );

  await page.goto('/');
  await page.evaluate(() => {
    const state = window as Window & {
      __lightBurnHeartbeat?: number;
      __lightBurnHeartbeatAtImport?: number;
    };
    state.__lightBurnHeartbeat = 0;
    delete state.__lightBurnHeartbeatAtImport;
    const observer = new MutationObserver(() => {
      if (!document.body.textContent?.includes('Objects: 1')) return;
      state.__lightBurnHeartbeatAtImport = state.__lightBurnHeartbeat ?? 0;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Open...' }).click();

  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Layers: 1 (1 output)', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/large-streamed\.lf2/);

  const heartbeatAtImport = await page.evaluate(
    () =>
      (window as Window & { __lightBurnHeartbeatAtImport?: number }).__lightBurnHeartbeatAtImport ??
      0,
  );
  expect(heartbeatAtImport).toBeGreaterThanOrEqual(3);

  const fixtureBytes = await page.evaluate(
    () => (window as Window & { __lightBurnFixtureBytes?: number }).__lightBurnFixtureBytes ?? 0,
  );
  expect(fixtureBytes).toBeGreaterThanOrEqual(FILLER_CHUNKS * FILLER_BYTES);
  expect(workerUrls.some((url) => url.includes('document-import-worker'))).toBe(true);

  await page.evaluate(() => {
    const timer = (window as Window & { __lightBurnHeartbeatTimer?: number })
      .__lightBurnHeartbeatTimer;
    if (timer !== undefined) window.clearInterval(timer);
  });
});
