import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const BASIC_PROJECT_PATH = fileURLToPath(new URL('./fixtures/project-basic.lf2', import.meta.url));
const BASIC_PROJECT = readFileSync(BASIC_PROJECT_PATH, 'utf8');
const FILLER_BYTES = 4_096;
const DEFAULT_FIXTURE_MIB = 24;
const requestedFixtureMib = Number.parseInt(
  process.env['CURVEDESK_NATIVE_PROJECT_TEST_MIB'] ?? '',
  10,
);
const FIXTURE_MIB = requestedFixtureMib > 0 ? requestedFixtureMib : DEFAULT_FIXTURE_MIB;
const FILLER_CHUNKS = FIXTURE_MIB * 256;

test(`opens a ${FIXTURE_MIB} MiB native project through the production worker while the UI stays responsive`, async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.addInitScript(
    ({ chunks, bytesPerChunk, project }) => {
      const state = window as Window & {
        __projectHeartbeat?: number;
        __projectHeartbeatAtOpen?: number;
        __projectHeartbeatTimer?: number;
        __projectFixtureBytes?: number;
        showOpenFilePicker?: () => Promise<readonly FileSystemFileHandle[]>;
      };
      state.showOpenFilePicker = async () => {
        const filler = ' '.repeat(bytesPerChunk);
        const file = new File(
          [...Array<string>(chunks).fill(filler), project],
          'large-streamed.lf2',
          {
            type: 'application/json',
          },
        );
        state.__projectFixtureBytes = file.size;
        return [
          { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle,
        ];
      };
      state.__projectHeartbeat = 0;
      state.__projectHeartbeatTimer = window.setInterval(() => {
        state.__projectHeartbeat = (state.__projectHeartbeat ?? 0) + 1;
        if (document.title.includes('large-streamed.lf2')) {
          state.__projectHeartbeatAtOpen ??= state.__projectHeartbeat;
        }
      }, 25);
    },
    { chunks: FILLER_CHUNKS, bytesPerChunk: FILLER_BYTES, project: BASIC_PROJECT },
  );

  await page.goto('/');
  await page.evaluate(() => {
    const state = window as Window & {
      __projectHeartbeat?: number;
      __projectHeartbeatAtOpen?: number;
    };
    state.__projectHeartbeat = 0;
    delete state.__projectHeartbeatAtOpen;
  });
  await page.getByRole('button', { name: 'Open...', exact: true }).click();

  await expect(page).toHaveTitle(/large-streamed\.lf2/, { timeout: 120_000 });
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();

  const heartbeatAtOpen = await page.evaluate(
    () => (window as Window & { __projectHeartbeatAtOpen?: number }).__projectHeartbeatAtOpen ?? 0,
  );
  expect(heartbeatAtOpen).toBeGreaterThanOrEqual(3);

  const fixtureBytes = await page.evaluate(
    () => (window as Window & { __projectFixtureBytes?: number }).__projectFixtureBytes ?? 0,
  );
  expect(fixtureBytes).toBeGreaterThanOrEqual(FILLER_CHUNKS * FILLER_BYTES);
  expect(workerUrls.some((url) => url.includes('document-import-worker'))).toBe(true);

  await page.evaluate(() => {
    const timer = (window as Window & { __projectHeartbeatTimer?: number }).__projectHeartbeatTimer;
    if (timer !== undefined) window.clearInterval(timer);
  });
});
