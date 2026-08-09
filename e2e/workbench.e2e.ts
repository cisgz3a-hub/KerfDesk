import { expect, test as baseTest, type Page } from '@playwright/test';
import { test as kerfDeskTest, type KerfDeskFixture } from './fixtures/kerfdesk-test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grayscaleTracePngBase64, writeQualifiedPngFixture } from './fixtures/png-fixture';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect x="5" y="5" width="30" height="20" fill="none" stroke="#ff0000"/></svg>';
const GRBL_SAFETY_DOOR_BYTE = 0x84;
const GRBL_RESUME_BYTE = 0x7e;
const GRBL_STATUS_QUERY_BYTE = 0x3f;
const PNG_BASE64 = readFileSync(
  join(
    process.cwd(),
    'src',
    '__fixtures__',
    'perceptual',
    'assets',
    'arch-house-langebaan-source.png',
  ),
).toString('base64');
const UNQUALIFIED_PNG_BASE64 = grayscaleTracePngBase64();

// Page-backing starts above PAGED_PNG_MIN_BYTES (25 MiB, ADR-283), so the
// page-backed route can only be exercised by a fixture larger than that. The
// image stays 1024x1024 — the sampled luma and 256-edge thumbnail assertions
// below describe the decoded image, not the file — and the file is padded to
// size with an ancillary chunk rather than pixels, so it writes in well under a
// second. Below this size the import embeds its bytes and the file stays portable.
const PAGE_BACKED_FIXTURE_BYTES = 26 * 1024 * 1024;
const PAGE_BACKED_FIXTURE_EDGE = 1024;

baseTest(
  'assembled workbench is keyboard navigable and canvas-first at 1024px',
  async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await expect(page.getByRole('menubar', { name: 'Application menu' })).toBeVisible();
    await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Side panel' })).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Artwork / Operations panel' }),
    ).toBeVisible();
    await expect(page.getByLabel('Laser controls')).toHaveCount(0);

    const file = page.getByRole('menuitem', { name: 'File' });
    await file.focus();
    await file.press('ArrowRight');
    const edit = page.getByRole('menuitem', { name: 'Edit' });
    await expect(edit).toBeFocused();
    await edit.press('ArrowRight');
    const tools = page.getByRole('menuitem', { name: 'Tools' });
    await expect(tools).toBeFocused();
    await tools.press('ArrowDown');
    await expect(page.getByRole('group', { name: 'Create & measure' })).toBeVisible();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Measure' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tools).toBeFocused();
  },
);

baseTest(
  'synthetic SVG import supports layer editing, Preview, Save, and machine switching',
  async ({ page }) => {
    const workerUrls: string[] = [];
    page.on('worker', (worker) => workerUrls.push(worker.url()));
    await page.setViewportSize({ width: 1024, height: 768 });
    await installFileSystemMocks(page);
    // SVG import must not cold-load the unrelated native-project parser graph.
    // CI exposed this as a worker startup stall before the first SVG result.
    await page.route('**/src/io/project/deserialize-project.ts', async (route) => {
      const referer = await route.request().headerValue('referer');
      if (referer?.includes('document-import-parse.ts')) {
        await new Promise((resolve) => setTimeout(resolve, 12_000));
      }
      await route.continue();
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Import SVG...' }).click();
    await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Layers: 1 (1 output)', { exact: true })).toBeVisible();
    expect(workerUrls.some((url) => url.includes('document-import-worker'))).toBe(true);

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Select all artwork using fixture' }).click();
    await expect(page.getByRole('region', { name: 'Selected artwork operation' })).toBeVisible();

    const layerMode = page.getByLabel('Mode for selected objects');
    await layerMode.selectOption('fill');
    await expect(layerMode).toHaveValue('fill');

    const preview = page.getByRole('button', { name: 'Preview', exact: true });
    await expect(preview).toBeEnabled();
    await preview.click();
    await expect(page.getByRole('group', { name: 'Preview options' })).toBeVisible();
    await preview.click();

    // A fresh no-homing project intentionally defaults to User Origin, which
    // needs a set origin (with a known work offset) before it can export. This
    // fixture is file-only, so deliberately choose Absolute before Save.
    await page.getByRole('tab', { name: 'Machine' }).click();
    await page.getByRole('button', { name: 'Expand Laser panel' }).click();
    const startFrom = page.getByLabel('Start from');
    await expect(startFrom).toHaveValue('user-origin');
    await startFrom.selectOption('absolute');
    await page.getByRole('tab', { name: 'Cuts / Layers' }).click();

    await page.getByRole('button', { name: 'Save G-code...' }).click();
    await acceptGcodeFilename(page);
    await expect
      .poll(() =>
        page.evaluate(() => Boolean((window as Window & { __e2eSaved?: string }).__e2eSaved)),
      )
      .toBe(true);

    await page.getByRole('button', { name: 'CNC', exact: true }).click();
    await expect(page.getByRole('button', { name: 'CNC', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('tab', { name: 'Machine' }).click();
    await expect(page.getByLabel('Router controls')).toBeVisible();
  },
);

baseTest(
  'Machine Setup saves a complete laser draft through the beginner flow',
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Machine Setup' });
    await expect(dialog).toContainText('Step 1 of 6 — Machine type');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('Step 2 of 6 — Choose your machine');
    await expect(dialog.getByLabel('Controller firmware')).toHaveValue('grbl-v1.1');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('Step 3 of 6 — Connect & detect');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('Step 4 of 6 — Confirm settings');
    await dialog.getByLabel('Device name').fill('E2E beginner laser');
    await dialog.getByLabel('Bed width (mm)').fill('510');
    await dialog.getByLabel('Bed width (mm)').blur();
    for (let step = 0; step < 2; step += 1) {
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    }

    await expect(dialog).toContainText('Software configuration is internally consistent');
    await expect(dialog).toContainText('Hardware commissioning — operator check after saving');
    await expect(dialog).not.toContainText('ready to cut');
    await dialog.getByRole('button', { name: 'Save machine setup', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
    const reopened = page.getByRole('dialog', { name: 'Machine Setup' });
    for (let step = 0; step < 3; step += 1) {
      await reopened.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(reopened.getByLabel('Device name')).toHaveValue('E2E beginner laser');
    await expect(reopened.getByLabel('Bed width (mm)')).toHaveValue('510');
  },
);

baseTest(
  'Machine Setup switches to CNC and commits CNC-only machine parameters',
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Machine Setup');

    await dialog.getByRole('radio', { name: /CNC only/ }).check();
    await expect(dialog).toHaveAccessibleName('CNC Startup Setup');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByLabel('Built-in CNC machine').selectOption('genmitsu-3018');
    await dialog.getByRole('button', { name: 'Load into draft', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('CNC machine limits');
    await expect(dialog).not.toContainText('Laser output and accessories');
    await dialog.getByRole('spinbutton', { name: 'Safe Z', exact: true }).fill('9');
    await dialog.getByRole('spinbutton', { name: 'Safe Z', exact: true }).blur();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('Z axis and probe');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save CNC startup setup', exact: true }).click();

    await expect(page.getByLabel('Router controls')).toBeVisible();
    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
    const reopened = page.getByRole('dialog', { name: 'CNC Startup Setup' });
    await reopened
      .getByRole('button', { name: 'Go to step 5: CNC Startup Setup', exact: true })
      .click();
    await expect(reopened.getByRole('spinbutton', { name: 'Safe Z', exact: true })).toHaveValue(
      '9',
    );
    await expect(
      reopened.getByRole('spinbutton', { name: 'Spindle maximum', exact: true }),
    ).toHaveValue('10000');
  },
);

baseTest('unconfigured auto-focus opens its setup section directly', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Set up auto-focus', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Machine Setup' });
  await expect(dialog).toContainText('Step 5 of 6 — Options & calibration');
  await expect(dialog).toContainText('Auto-focus setup');
  await expect(dialog.getByLabel('Auto-focus command or macro')).toBeVisible();
});

baseTest('Machine Setup stays navigable at the narrow breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Machine' }).click();
  await page.getByRole('button', { name: 'Expand Laser panel' }).click();
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Machine Setup' });
  await expect(dialog).toContainText('Step 1 of 6 — Machine type');
  await expect(dialog.getByRole('navigation', { name: 'Machine Setup steps' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  const responsiveLayout = await dialog.locator('.lf-machine-setup-layout').evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns,
    width: element.getBoundingClientRect().width,
  }));
  expect(responsiveLayout.columns.split(' ')).toHaveLength(1);
  expect(responsiveLayout.width).toBeGreaterThan(500);

  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog).toContainText('Step 2 of 6 — Choose your machine');
});

// The CNC laptop-layout test covered the 3D result pane's canvas-focus /
// split-view behaviour. That pane is not mounted while its rebuild cost freezes
// the app (see App.tsx), so there is nothing for it to drive. Restore it with
// the pane.

kerfDeskTest(
  'Machine Setup reads first, queues safely, then writes and verifies after Save',
  async ({ page, kerfdesk }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Machine Setup' });
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: /^Connect/ }).click();
    await expect(dialog).toContainText('Controller connected.');

    await kerfdesk.setSerialSetting(130, '350');
    const beforeRead = serialWrites(await kerfdesk.events()).length;
    await dialog.getByRole('button', { name: 'Run read-only checks', exact: true }).click();
    await expect
      .poll(async () => serialWrites(await kerfdesk.events()).slice(beforeRead))
      .toContain('$I\n');
    await expect
      .poll(async () => serialWrites(await kerfdesk.events()).slice(beforeRead))
      .toContain('$$\n');
    expect(serialWrites(await kerfdesk.events()).slice(beforeRead)).not.toMatch(/\$\d+=/);
    await expect(dialog).toContainText('Bed width: 350.000 mm');

    await dialog.getByRole('button', { name: 'Use detected values', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText(
      'Detected values applied to this setup draft',
    );

    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByLabel('GRBL $30 max power S').fill('900');
    await dialog.getByLabel('GRBL $30 max power S').blur();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('Queue $30 for Save');

    await dialog.getByRole('button', { name: 'Export backup', exact: true }).click();
    await expect
      .poll(async () => Object.keys(await kerfdesk.savedFiles()).length)
      .toBeGreaterThan(0);
    await dialog.getByLabel('Confirm controller backup exported').check();
    await dialog.getByLabel('Confirm write $30').check();
    const beforeQueue = serialWrites(await kerfdesk.events()).length;
    await dialog.getByRole('button', { name: 'Queue $30 for Save', exact: true }).click();
    await expect(dialog).toContainText('Remove queued $30');
    expect(serialWrites(await kerfdesk.events()).slice(beforeQueue)).not.toContain('$30=900');

    await expect(dialog).toContainText('$30=900; exact re-read required');
    const beforeSave = serialWrites(await kerfdesk.events()).length;
    await dialog
      .getByRole('button', { name: 'Save setup and write 1 setting', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => serialWrites(await kerfdesk.events()).slice(beforeSave))
      .toContain('$30=900\n');
    expect(serialWrites(await kerfdesk.events()).slice(beforeSave)).toContain('$$\n');

    await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
    const reopened = page.getByRole('dialog', { name: 'Machine Setup' });
    for (let step = 0; step < 3; step += 1) {
      await reopened.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(reopened.getByLabel('GRBL $30 max power S')).toHaveValue('900');
  },
);

baseTest(
  'qualified PNG stays page-backed through canvas preview and G-code Save',
  async ({ page }) => {
    baseTest.setTimeout(120_000);
    const workerUrls: string[] = [];
    page.on('worker', (worker) => workerUrls.push(worker.url()));
    await page.addInitScript(() => {
      const originalStream = Blob.prototype.stream;
      Blob.prototype.stream = function stream() {
        const state = window as Window & { __e2eBlobStreamCalls?: number };
        state.__e2eBlobStreamCalls = (state.__e2eBlobStreamCalls ?? 0) + 1;
        return originalStream.call(this);
      };
      const originalArrayBuffer = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function arrayBuffer() {
        if (this instanceof File) {
          const state = window as Window & { __e2eFileArrayBufferCalls?: number };
          state.__e2eFileArrayBufferCalls = (state.__e2eFileArrayBufferCalls ?? 0) + 1;
        }
        return originalArrayBuffer.call(this);
      };
      const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        ...(src?.get === undefined ? {} : { get: src.get }),
        set(value: string) {
          const state = window as Window & { __e2eRasterImageSources?: string[] };
          state.__e2eRasterImageSources ??= [];
          state.__e2eRasterImageSources.push(value);
          src?.set?.call(this, value);
        },
      });
    });
    await installFileSystemMocks(page);
    // Installed after the mocks so it wins: the page-backed route needs a real
    // on-disk file above the threshold, which an inlined base64 fixture cannot
    // carry. Save still uses the mocked directory picker above.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: () =>
          new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.addEventListener(
              'change',
              () => {
                const file = input.files?.[0];
                if (file === undefined) {
                  reject(new DOMException('No file selected', 'AbortError'));
                  return;
                }
                resolve([{ kind: 'file', name: file.name, getFile: async () => file }]);
              },
              { once: true },
            );
            input.click();
          }),
      });
    });
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'curvedesk-workbench-png-'));
    const fixturePath = join(fixtureDirectory, 'qualified-page-backed.png');
    writeQualifiedPngFixture(
      fixturePath,
      PAGE_BACKED_FIXTURE_BYTES,
      PAGE_BACKED_FIXTURE_EDGE,
      PAGE_BACKED_FIXTURE_EDGE,
    );
    try {
      await runPageBackedImport(page, fixturePath, workerUrls);
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  },
);

async function runPageBackedImport(
  page: Page,
  fixturePath: string,
  workerUrls: readonly string[],
): Promise<void> {
  await page.goto('/');
  {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Image...' }).click();
    await (await chooser).setFiles(fixturePath);
    await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible({ timeout: 60_000 });
    expect(workerUrls.some((url) => url.includes('png-import-worker'))).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as Window & { __e2eBlobStreamCalls?: number }).__e2eBlobStreamCalls ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    const retained = await page.evaluate(async () => {
      const statePath = '/src/ui/state/index.ts';
      const state = (await import(/* @vite-ignore */ statePath)) as {
        useStore?: { getState(): { project: { scene: { objects: unknown[] } } } };
      };
      const object = state.useStore?.getState().project.scene.objects[0] as
        | {
            dataUrl?: string;
            lumaBase64?: string;
            imageAsset?: {
              sourceByteLength: number;
              lumaByteLength: number;
              thumbnail: { dataUrl: string; width: number; height: number };
            };
          }
        | undefined;
      const imageSources =
        (window as Window & { __e2eRasterImageSources?: string[] }).__e2eRasterImageSources ?? [];
      const fileArrayBufferCalls =
        (window as Window & { __e2eFileArrayBufferCalls?: number }).__e2eFileArrayBufferCalls ?? 0;
      const decodedThumbnail =
        object?.imageAsset === undefined
          ? null
          : await new Promise<{ width: number; height: number }>((resolve, reject) => {
              const image = new Image();
              image.onload = () =>
                resolve({ width: image.naturalWidth, height: image.naturalHeight });
              image.onerror = () => reject(new Error('bounded PNG thumbnail did not decode'));
              image.src = object.imageAsset?.thumbnail.dataUrl ?? '';
            });
      return { object, imageSources, decodedThumbnail, fileArrayBufferCalls };
    });
    expect(retained.object).not.toHaveProperty('dataUrl');
    expect(retained.object).not.toHaveProperty('lumaBase64');
    expect(retained.fileArrayBufferCalls).toBe(0);
    expect(retained.object?.imageAsset).toMatchObject({
      sourceByteLength: PAGE_BACKED_FIXTURE_BYTES,
      lumaByteLength: PAGE_BACKED_FIXTURE_EDGE * PAGE_BACKED_FIXTURE_EDGE,
      thumbnail: { width: 256, height: 256 },
    });
    expect(
      retained.object?.imageAsset?.thumbnail.dataUrl.startsWith('data:image/bmp;base64,'),
    ).toBe(true);
    expect(retained.object?.imageAsset?.thumbnail.dataUrl.length).toBeLessThan(300_000);
    expect(retained.decodedThumbnail).toEqual({ width: 256, height: 256 });
    expect(
      retained.imageSources.some((source) => source.startsWith('data:image/bmp;base64,')),
    ).toBe(true);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Preview options' })).toBeVisible();
    await expect
      .poll(() => workerUrls.some((url) => url.includes('preparation-worker')))
      .toBe(true);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();

    await page.evaluate(async () => {
      const statePath = '/src/ui/state/index.ts';
      const state = (await import(/* @vite-ignore */ statePath)) as {
        useStore?: {
          getState(): { jobPlacement: Record<string, unknown> };
          setState(next: { jobPlacement: Record<string, unknown> }): void;
        };
      };
      const store = state.useStore;
      if (store === undefined) throw new Error('application store is unavailable');
      store.setState({
        jobPlacement: { ...store.getState().jobPlacement, startFrom: 'absolute' },
      });
    });
    await page.getByRole('button', { name: 'Save G-code...' }).click();
    await acceptGcodeFilename(page);
    await expect
      .poll(() =>
        page.evaluate(() => (window as Window & { __e2eSaved?: string }).__e2eSaved ?? ''),
      )
      .toMatch(/S[1-9]\d*/);
    expect(workerUrls.some((url) => url.includes('output-preparation-worker'))).toBe(true);
  }
}

baseTest('unqualified bitmap legacy fallback still reaches Trace and commits', async ({ page }) => {
  await installFileSystemMocks(page, UNQUALIFIED_PNG_BASE64);
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Image...' }).click();
  const trace = page.getByRole('button', { name: 'Trace Image...' });
  await expect(trace).toBeEnabled();
  await trace.click();
  await expect(page.getByRole('dialog', { name: 'Trace image' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trace', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Trace image' })).toHaveCount(0);
  await expect(page.getByText('Objects: 2', { exact: true })).toBeVisible();
});

kerfDeskTest(
  'controller positions, not acknowledgements, drive the live canvas trail',
  async ({ page, kerfdesk }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open...' }).click();
    const probe = page.getByTestId('canvas-motion-probe');
    await expect(probe).toHaveAttribute('aria-label', /Frame start ready; Job start ready/);
    await connectAndHome(page, kerfdesk);

    // ADR-228/ADR-237: Start is available only after the exact compiled job has
    // completed a Frame, and that Frame runs dialog-free.
    const frameButton = page.getByRole('button', { name: 'Frame job', exact: true });
    const writesBeforeFrame = serialWrites(await kerfdesk.events()).length;
    await frameButton.click();
    await expect
      .poll(async () => serialWrites(await kerfdesk.events()).slice(writesBeforeFrame))
      .toContain('$J=G90 G21');
    const startButton = page.getByRole('button', { name: 'Start framed job', exact: true });
    await expect(startButton).toBeEnabled();

    await kerfdesk.setAutoAcknowledge(false);
    const baselineLines = serialWriteLineCount(await kerfdesk.events());
    const writesBefore = serialWrites(await kerfdesk.events()).length;
    await startButton.click();
    await confirmStartReview(page);
    await expect(probe).toHaveAttribute('data-lifecycle', 'running');
    const pixelsBeforeStatus = await canvasPixels(page);
    const initial = Number(await probe.getAttribute('data-confirmed-route-mm'));

    const program = serialWrites(await kerfdesk.events()).slice(writesBefore);
    const firstMove = /G0 X(-?\d+(?:\.\d+)?) Y(-?\d+(?:\.\d+)?)/.exec(program);
    expect(firstMove).not.toBeNull();
    const acceptedThroughFirstMove =
      [...program.slice(0, firstMove?.index ?? 0)].filter((character) => character === '\n')
        .length + 1;
    await kerfdesk.acknowledgeSerial(acceptedThroughFirstMove);
    await expect
      .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
      .toBe(initial);

    const x = Number(firstMove?.[1] ?? 0);
    const y = Number(firstMove?.[2] ?? 0);
    await kerfdesk.emitSerialLine(
      `<Run|MPos:${(x / 2).toFixed(3)},${(y / 2).toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:1500,0>`,
    );
    await expect
      .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
      .toBeGreaterThan(initial);
    const pixelsAfterStatus = await canvasPixels(page);
    expect(pixelsAfterStatus.motion).not.toBe(pixelsBeforeStatus.motion);
    expect(pixelsAfterStatus.design).toBe(pixelsBeforeStatus.design);

    const trustedHeadX = await probe.getAttribute('data-reported-head-x');
    const trustedHeadY = await probe.getAttribute('data-reported-head-y');
    expect(trustedHeadX).not.toBeNull();
    expect(trustedHeadY).not.toBeNull();
    await kerfdesk.emitSerialLine(
      '<Run|MPos:999.000,999.000,0.000|WCO:0.000,0.000,0.000|FS:1500,0>',
    );
    await expect(page.getByTestId('canvas-motion-status')).toContainText('Route match uncertain');
    await expect(probe).toHaveAttribute('data-reported-head-x', trustedHeadX ?? '');
    await expect(probe).toHaveAttribute('data-reported-head-y', trustedHeadY ?? '');
    expect((await canvasPixels(page)).motion).toBe(pixelsAfterStatus.motion);

    const pauseBytesBefore = serialWriteBytes(await kerfdesk.events()).length;
    await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
    await expect
      .poll(async () =>
        hasSerialByteSequence(serialWriteBytes(await kerfdesk.events()).slice(pauseBytesBefore), [
          GRBL_SAFETY_DOOR_BYTE,
          GRBL_STATUS_QUERY_BYTE,
        ]),
      )
      .toBe(true);
    const atPause = Number(await probe.getAttribute('data-confirmed-route-mm'));
    await kerfdesk.emitSerialLine(
      `<Hold:0|MPos:${x.toFixed(3)},${y.toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>`,
    );
    await expect(probe).toHaveAttribute('data-lifecycle', 'paused');
    await expect(page.getByTestId('canvas-motion-status')).toContainText('Hold');
    expect(Number(await probe.getAttribute('data-confirmed-route-mm'))).toBe(atPause);
    const resumeBytesBefore = serialWriteBytes(await kerfdesk.events()).length;
    await page.getByRole('button', { name: 'Resume', exact: true }).first().click();
    await expect
      .poll(async () =>
        hasSerialByteSequence(serialWriteBytes(await kerfdesk.events()).slice(resumeBytesBefore), [
          GRBL_RESUME_BYTE,
          GRBL_STATUS_QUERY_BYTE,
        ]),
      )
      .toBe(true);
    await kerfdesk.emitSerialLine(
      `<Run|MPos:${x.toFixed(3)},${y.toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:1500,0|Ov:100,100,100>`,
    );
    await expect
      .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
      .toBeGreaterThan(atPause);

    await drainHeldSerialWrites(page, kerfdesk, baselineLines, acceptedThroughFirstMove);
    await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
    await expect(probe).toHaveAttribute('data-lifecycle', 'finished');
    expect(Number(await probe.getAttribute('data-confirmed-route-mm'))).toBeGreaterThan(atPause);
  },
);

baseTest('an interrupted-job checkpoint surfaces isolated optional recovery', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'laserforge.job-checkpoint.v1',
      JSON.stringify({
        schemaVersion: 3,
        fingerprint: { fnv1a: 1, chars: 8, lines: 3 },
        sendableLines: 2,
        ackedLines: 1,
        resumeInFlight: false,
        machineKind: 'laser',
        outputScope: {
          cutSelectedGraphics: false,
          useSelectionOrigin: false,
          selectedObjectIds: [],
        },
        startedAtIso: '2026-07-11T12:00:00.000Z',
        updatedAtIso: '2026-07-11T12:00:01.000Z',
      }),
    );
  });
  await page.goto('/');
  const savedRecovery = page.getByText('Interrupted job saved', { exact: true });
  await expect(savedRecovery).toBeVisible();
  await expect(page.getByText('Last Start attempt blocked', { exact: true })).toHaveCount(0);
  await savedRecovery.click();
  await expect(
    page.getByText('It is isolated from the current canvas', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review recovery' })).toBeVisible();
});

// ADR-237: Frame runs dialog-free and mints a review-pending permit; the
// single Job Review opens at Start and streams that exact artifact on confirm.
async function confirmStartReview(page: Page): Promise<void> {
  await page
    .getByRole('dialog', { name: 'Review job before starting' })
    .getByRole('button', { name: 'Start job', exact: true })
    .click();
}

async function installFileSystemMocks(page: Page, pngBase64 = PNG_BASE64): Promise<void> {
  await page.addInitScript(
    ({ svg, pngBase64 }) => {
      const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
      interface PickerOptions {
        readonly types?: readonly { readonly accept?: Record<string, string[]> }[];
      }
      const fileWindow = window as unknown as Window & {
        showOpenFilePicker: (options?: PickerOptions) => Promise<readonly FileSystemFileHandle[]>;
        showSaveFilePicker: () => Promise<FileSystemFileHandle>;
        showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
      };
      fileWindow.showOpenFilePicker = async (options) => {
        const extensions =
          options?.types?.flatMap((type) => Object.values(type.accept ?? {}).flat()) ?? [];
        const image = extensions.includes('.png');
        const file = image
          ? new File([bytes], 'trace-source.png', { type: 'image/png' })
          : new File([svg], 'fixture.svg', { type: 'image/svg+xml' });
        return [
          { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle,
        ];
      };
      fileWindow.showSaveFilePicker = async () =>
        ({
          kind: 'file',
          name: 'synthetic.gcode',
          getFile: async () => new File([], 'synthetic.gcode'),
          createWritable: async () => ({
            write: async (data: string | Blob | BufferSource) => {
              (window as Window & { __e2eSaved?: string }).__e2eSaved =
                typeof data === 'string' ? data : 'binary';
            },
            close: async () => undefined,
            abort: async () => undefined,
          }),
        }) as FileSystemFileHandle;
      fileWindow.showDirectoryPicker = async () =>
        ({
          kind: 'directory',
          name: 'synthetic-output',
          getFileHandle: async (name: string) =>
            ({
              kind: 'file',
              name,
              getFile: async () => new File([], name),
              createWritable: async () => ({
                write: async (data: string | Blob | BufferSource) => {
                  (window as Window & { __e2eSaved?: string }).__e2eSaved =
                    typeof data === 'string' ? data : 'binary';
                },
                close: async () => undefined,
                abort: async () => undefined,
              }),
            }) as FileSystemFileHandle,
        }) as FileSystemDirectoryHandle;
    },
    { svg: SVG, pngBase64 },
  );
}

async function connectAndHome(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Machine settings detected:/)).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('G4 P0.01');
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
}

async function acceptGcodeFilename(page: Page): Promise<void> {
  const panel = page.getByRole('dialog', { name: 'Choose G-code filename' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
}

interface CanvasPixels {
  readonly design: string;
  readonly motion: string;
}

async function canvasPixels(page: Page): Promise<CanvasPixels> {
  const design = page.locator('canvas[aria-label*="workspace"]');
  const motion = page.getByTestId('canvas-motion-layer');
  await expect(design).toHaveCount(1);
  await expect(motion).toHaveCount(1);
  return {
    design: await design.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    motion: await motion.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
  };
}

function serialWrites(events: readonly Readonly<Record<string, unknown>>[]): string {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .join('');
}

function serialWriteBytes(events: readonly Readonly<Record<string, unknown>>[]): number[] {
  return events.flatMap((event) => {
    if (event['kind'] !== 'serial-write') return [];
    const bytes = event['bytes'];
    if (!Array.isArray(bytes)) return [];
    return bytes.filter((value): value is number => typeof value === 'number');
  });
}

function hasSerialByteSequence(bytes: readonly number[], sequence: readonly number[]): boolean {
  for (let index = 0; index <= bytes.length - sequence.length; index += 1) {
    if (sequence.every((byte, offset) => bytes[index + offset] === byte)) return true;
  }
  return false;
}

function serialWriteLineCount(events: readonly Readonly<Record<string, unknown>>[]): number {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .reduce((count, text) => count + [...text].filter((character) => character === '\n').length, 0);
}

async function drainHeldSerialWrites(
  page: Page,
  kerfdesk: KerfDeskFixture,
  baselineLines: number,
  alreadyAcknowledged: number,
): Promise<void> {
  let acknowledged = alreadyAcknowledged;
  let stablePasses = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const written = serialWriteLineCount(await kerfdesk.events()) - baselineLines;
    const pending = written - acknowledged;
    if (pending > 0) {
      await kerfdesk.acknowledgeSerial(pending);
      acknowledged += pending;
      stablePasses = 0;
    } else {
      stablePasses += 1;
      if (stablePasses >= 3) return;
    }
    await page.waitForTimeout(25);
  }
  throw new Error('Held serial writes did not drain.');
}
