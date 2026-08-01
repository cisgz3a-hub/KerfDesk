import { expect, test } from '@playwright/test';

const MATERIAL_LIBRARY = JSON.stringify({
  format: 'laserforge-material-library',
  librarySchemaVersion: 1,
  libraryId: 'large-streamed-library',
  name: 'Large streamed library',
  entries: [],
});
const FILLER_BYTES = 4_096;
const DEFAULT_FIXTURE_MIB = 24;
const requestedFixtureMib = Number.parseInt(
  process.env['CURVEDESK_MATERIAL_LIBRARY_TEST_MIB'] ?? '',
  10,
);
const FIXTURE_MIB = requestedFixtureMib > 0 ? requestedFixtureMib : DEFAULT_FIXTURE_MIB;
const FILLER_CHUNKS = FIXTURE_MIB * 256;

test(`imports a ${FIXTURE_MIB} MiB native material library through the production worker while the UI stays responsive`, async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.addInitScript(
    ({ chunks, bytesPerChunk, library }) => {
      const state = window as Window & {
        __materialHeartbeat?: number;
        __materialHeartbeatAtLoad?: number;
        __materialHeartbeatTimer?: number;
        __materialFixtureBytes?: number;
        showOpenFilePicker?: () => Promise<readonly FileSystemFileHandle[]>;
      };
      state.showOpenFilePicker = async () => {
        const filler = ' '.repeat(bytesPerChunk);
        const file = new File(
          [...Array<string>(chunks).fill(filler), library],
          'large-streamed.lfml.json',
          { type: 'application/json' },
        );
        state.__materialFixtureBytes = file.size;
        return [
          { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle,
        ];
      };
      state.__materialHeartbeat = 0;
      state.__materialHeartbeatTimer = window.setInterval(() => {
        state.__materialHeartbeat = (state.__materialHeartbeat ?? 0) + 1;
        if (document.body?.innerText.includes('Loaded material library: Large streamed library')) {
          state.__materialHeartbeatAtLoad ??= state.__materialHeartbeat;
        }
      }, 25);
    },
    { chunks: FILLER_CHUNKS, bytesPerChunk: FILLER_BYTES, library: MATERIAL_LIBRARY },
  );

  await page.goto('/');
  await page.getByRole('tab', { name: 'Materials' }).click();
  await page.getByRole('button', { name: 'Open saved libraries' }).click();
  await page.evaluate(() => {
    const state = window as Window & {
      __materialHeartbeat?: number;
      __materialHeartbeatAtLoad?: number;
    };
    state.__materialHeartbeat = 0;
    delete state.__materialHeartbeatAtLoad;
  });
  await page.getByRole('button', { name: 'Import library' }).click();

  await expect(page.getByText('Loaded material library: Large streamed library')).toBeVisible({
    timeout: 120_000,
  });
  const heartbeatAtLoad = await page.evaluate(
    () =>
      (window as Window & { __materialHeartbeatAtLoad?: number }).__materialHeartbeatAtLoad ?? 0,
  );
  expect(heartbeatAtLoad).toBeGreaterThanOrEqual(3);

  const fixtureBytes = await page.evaluate(
    () => (window as Window & { __materialFixtureBytes?: number }).__materialFixtureBytes ?? 0,
  );
  expect(fixtureBytes).toBeGreaterThanOrEqual(FILLER_CHUNKS * FILLER_BYTES);
  expect(workerUrls.some((url) => url.includes('document-import-worker'))).toBe(true);

  await page.evaluate(() => {
    const timer = (window as Window & { __materialHeartbeatTimer?: number })
      .__materialHeartbeatTimer;
    if (timer !== undefined) window.clearInterval(timer);
  });
});
