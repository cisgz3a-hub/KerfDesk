import type { Project, RasterImage } from '../src/core/scene';
import type { AppState } from '../src/ui/state/store';
import {
  expect,
  test as fixtureTest,
  type Page,
  type KerfDeskFixture,
} from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

// Independent projects share only the warm renderer/module graph. Playwright
// replaces the worker and page after a failure; setup resets project/tool state.
let sharedPage: Page | undefined;
const test = fixtureTest.extend({
  page: async ({ browser }, use) => {
    sharedPage ??= await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await use(sharedPage);
  },
});
test.setTimeout(600_000);
test.use({ actionTimeout: 30_000 });
test.afterAll(async () => {
  await sharedPage?.close();
});

async function openWorkspace(page: Page): Promise<void> {
  if (page.url() === 'about:blank') await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByRole('menubar', { name: 'Application menu' })).toBeVisible({
    timeout: 480_000,
  });
  await page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const uiUrl = '/src/ui/state/ui-store.ts';
    const { useStore } = await import(storeUrl);
    const { useUiStore } = await import(uiUrl);
    useStore.getState().newProject();
    useUiStore.getState().resetToolMode();
  });
}

async function command(page: Page, id: string): Promise<void> {
  const menu = page.locator('details[data-menu-family="tools"]');
  await menu.locator('summary').click();
  const action = menu.locator(`[data-help-id="command:tools.${id}"]`);
  await expect(action).toBeEnabled();
  await action.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath(`tools-${id}.png`) });
  await action.click();
}

async function project(page: Page): Promise<Project> {
  return page.evaluate(async () => {
    const url = '/src/ui/state/index.ts';
    const { useStore } = (await import(url)) as { useStore: { getState(): AppState } };
    return useStore.getState().project;
  });
}

async function importedImage(page: Page, fixture: KerfDeskFixture): Promise<RasterImage> {
  await openWorkspace(page);
  await fixture.setOpenFiles([{ name: 'audit.png', kind: 'png-fixture', width: 64, height: 64 }]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect.poll(async () => (await project(page)).scene.objects.length).toBe(1);
  const image = (await project(page)).scene.objects[0];
  if (image?.kind !== 'raster-image') throw new Error('Expected imported raster');
  return image;
}

async function undo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
}

test('Image Studio commits inverted pixels and the project Undo restores them', async ({
  page,
  kerfdesk,
}) => {
  const before = await importedImage(page, kerfdesk);
  await command(page, 'edit-image');
  const editor = page.getByRole('dialog', { name: /^Image Studio/ });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Adjust', exact: true }).click();
  await editor.getByRole('menuitem', { name: /^Invert/ }).click();
  await editor.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect
    .poll(async () => ((await project(page)).scene.objects[0] as RasterImage).lumaBase64)
    .not.toBe(before.lumaBase64);
  const after = (await project(page)).scene.objects[0] as RasterImage;
  const a = Buffer.from(before.lumaBase64 ?? '', 'base64');
  const b = Buffer.from(after.lumaBase64 ?? '', 'base64');
  expect(b.length).toBe(a.length);
  expect([...b].every((value, index) => value === 255 - (a[index] ?? 0))).toBe(true);
  await editor.getByRole('button', { name: 'Close Image Studio' }).click();
  await undo(page);
  expect(((await project(page)).scene.objects[0] as RasterImage).lumaBase64).toBe(
    before.lumaBase64,
  );
});

test('Adjust Image and Photo engraving apply settings through their dialogs and undo', async ({
  page,
  kerfdesk,
}) => {
  await importedImage(page, kerfdesk);
  const before = await project(page);
  await command(page, 'adjust-image');
  const adjust = page.getByRole('dialog', { name: 'Adjust Image', exact: true });
  await adjust.getByRole('spinbutton', { name: 'Adjust image Brightness', exact: true }).fill('17');
  await adjust.getByRole('spinbutton', { name: 'Adjust image Brightness', exact: true }).blur();
  await adjust.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(adjust).toBeHidden();
  expect((await project(page)).scene.objects[0]).toMatchObject({ brightness: 17 });
  await undo(page);
  expect((await project(page)).scene).toEqual(before.scene);
  await command(page, 'photo-engraving');
  const photo = page.getByRole('dialog', { name: 'Photo engraving', exact: true });
  await photo.getByRole('combobox', { name: 'Photo processing' }).selectOption('stucki');
  await photo.getByRole('spinbutton', { name: 'Photo midtones (gamma)' }).fill('1.2');
  await photo.getByRole('spinbutton', { name: 'Photo midtones (gamma)' }).blur();
  await photo.getByRole('button', { name: 'Apply photo settings' }).click();
  await expect(photo).toBeHidden();
  expect((await project(page)).scene.objects[0]).toMatchObject({ gamma: 1.2 });
  expect((await project(page)).scene.layers).toEqual(before.scene.layers);
  await command(page, 'adjust-image');
  const dither = adjust.getByRole('combobox', { name: 'Adjust image dither', exact: true });
  await expect(dither).toHaveValue('stucki');
  await dither.selectOption('jarvis');
  await adjust.getByRole('button', { name: 'OK', exact: true }).click();
  expect((await project(page)).scene.layers).toEqual(before.scene.layers);
  await command(page, 'adjust-image');
  await expect(dither).toHaveValue('jarvis');
  await adjust.getByRole('button', { name: 'Cancel', exact: true }).click();
  await undo(page);
  await command(page, 'adjust-image');
  await expect(dither).toHaveValue('stucki');
  await adjust.getByRole('button', { name: 'Cancel', exact: true }).click();
  await undo(page);
  expect((await project(page)).scene).toEqual(before.scene);
});

test('Apply, Remove, Crop and Flatten masks preserve pixels, reference rules and Undo', async ({
  page,
  kerfdesk,
}) => {
  const image = await importedImage(page, kerfdesk);
  await page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const shapeUrl = '/src/core/shapes/primitives/index.ts';
    const { useStore } = (await import(storeUrl)) as {
      useStore: { getState(): AppState; setState(value: Partial<AppState>): void };
    };
    const { createRectangle } = (await import(
      shapeUrl
    )) as typeof import('../src/core/shapes/primitives');
    const state = useStore.getState();
    const raster = state.project.scene.objects[0];
    if (raster?.kind !== 'raster-image') throw new Error('Missing raster fixture');
    const mask = createRectangle({
      id: 'audit-mask',
      color: raster.color,
      spec: {
        widthMm: (raster.bounds.maxX - raster.bounds.minX) / 2,
        heightMm: raster.bounds.maxY - raster.bounds.minY,
        cornerRadiusMm: 0,
      },
      transform: raster.transform,
    });
    useStore.setState({
      project: { ...state.project, scene: { ...state.project.scene, objects: [raster, mask] } },
      selectedObjectId: raster.id,
      additionalSelectedIds: new Set([mask.id]),
    });
  });
  await command(page, 'apply-image-mask');
  expect((await project(page)).scene.objects[0]).toMatchObject({ imageMaskId: 'audit-mask' });
  await page.evaluate(async () => {
    const url = '/src/ui/state/index.ts';
    const { useStore } = (await import(url)) as {
      useStore: { setState(value: Partial<AppState>): void };
    };
    useStore.setState({ additionalSelectedIds: new Set() });
  });
  await command(page, 'remove-image-mask');
  expect((await project(page)).scene.objects[0]).not.toHaveProperty('imageMaskId');
  expect(((await project(page)).scene.objects[0] as RasterImage).lumaBase64).toBe(image.lumaBase64);
  await undo(page);
  await command(page, 'crop-image');
  await expect
    .poll(async () => ((await project(page)).scene.objects[0] as RasterImage).pixelWidth)
    .toBe(32);
  const cropped = (await project(page)).scene.objects[0] as RasterImage;
  const sourcePixels = Buffer.from(image.lumaBase64 ?? '', 'base64');
  const croppedPixels = Buffer.from(cropped.lumaBase64 ?? '', 'base64');
  expect(croppedPixels.length).toBe(32 * 64);
  for (let row = 0; row < 64; row++) {
    expect(croppedPixels.subarray(row * 32, (row + 1) * 32)).toEqual(
      sourcePixels.subarray(row * 64, row * 64 + 32),
    );
  }
  expect((await project(page)).scene.objects).toHaveLength(2);
  await undo(page);
  await command(page, 'flatten-image-mask');
  await expect.poll(async () => (await project(page)).scene.objects.length).toBe(1);
  expect((await project(page)).scene.objects[0]).toMatchObject({ pixelWidth: 32, pixelHeight: 64 });
  expect((await project(page)).scene.objects[0]).not.toHaveProperty('imageMaskId');
  await undo(page);
  expect((await project(page)).scene.objects).toHaveLength(2);
  expect((await project(page)).scene.objects[0]).toMatchObject({
    imageMaskId: 'audit-mask',
    pixelWidth: 64,
  });
});

test('Original PNG/JPEG/BMP and Processed PNG export decodable pixels without changing the scene', async ({
  page,
  kerfdesk,
}) => {
  const image = await importedImage(page, kerfdesk);
  await page.evaluate(() => {
    const state = window as unknown as {
      auditBlobs: Record<string, Blob>;
      showSaveFilePicker: (options: { suggestedName: string }) => Promise<{
        createWritable(): Promise<{
          write(data: Blob | string): Promise<void>;
          close(): Promise<void>;
        }>;
      }>;
    };
    state.auditBlobs = {};
    const original = state.showSaveFilePicker;
    state.showSaveFilePicker = async (options) => {
      const handle = await original(options);
      const create = handle.createWritable.bind(handle);
      handle.createWritable = async () => {
        const writable = await create();
        const write = writable.write.bind(writable);
        writable.write = async (data) => {
          state.auditBlobs[options.suggestedName] = data instanceof Blob ? data : new Blob([data]);
          await write(data);
        };
        return writable;
      };
      return handle;
    };
  });
  await command(page, 'save-original-image');
  const dialog = page.getByRole('dialog', { name: 'Save Original Image', exact: true });
  await dialog.getByRole('button', { name: 'Save...', exact: true }).click();
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles())).toContain('audit.png');
  for (const [format, filename] of [
    ['jpeg', 'audit.jpg'],
    ['bmp', 'audit.bmp'],
  ] as const) {
    await command(page, 'save-original-image');
    await dialog.getByRole('combobox', { name: 'Image format' }).selectOption(format);
    await dialog.getByRole('button', { name: 'Save...', exact: true }).click();
    await expect.poll(async () => Object.keys(await kerfdesk.savedFiles())).toContain(filename);
  }
  await command(page, 'save-processed-bitmap');
  await expect
    .poll(async () => Object.keys(await kerfdesk.savedFiles()))
    .toContain('audit-processed.png');
  const bytes = await page.evaluate(async () => {
    const blobs = (window as typeof window & { auditBlobs: Record<string, Blob> }).auditBlobs;
    const result: Record<string, { bytes: number[]; width: number; height: number; dark: number }> =
      {};
    for (const [name, blob] of Object.entries(blobs)) {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No canvas');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      result[name] = {
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        width: canvas.width,
        height: canvas.height,
        dark: pixels.filter((value, index) => index % 4 === 0 && value < 128).length,
      };
    }
    return result;
  });
  expect(bytes['audit.png']?.bytes).toEqual([
    ...Buffer.from(image.dataUrl?.split(',')[1] ?? '', 'base64'),
  ]);
  expect(bytes['audit-processed.png']?.bytes.slice(0, 8)).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  expect(bytes['audit-processed.png']?.dark).toBeGreaterThan(0);
  expect(bytes['audit.jpg']?.bytes.slice(0, 2)).toEqual([255, 216]);
  expect(bytes['audit.bmp']?.bytes.slice(0, 2)).toEqual([66, 77]);
  for (const name of ['audit.png', 'audit.jpg', 'audit.bmp', 'audit-processed.png']) {
    expect(bytes[name]?.width).toBe(image.pixelWidth);
    expect(bytes[name]?.height).toBe(image.pixelHeight);
    expect(bytes[name]?.dark).toBeGreaterThan(0);
  }
  expect((await project(page)).scene.objects[0]).toEqual(image);
});

test('Trace, Re-trace and Multi-File Trace retain source/settings and write real vector files', async ({
  page,
  kerfdesk,
}) => {
  const source = await importedImage(page, kerfdesk);
  await command(page, 'trace-image');
  const trace = page.getByRole('dialog', { name: 'Trace image', exact: true });
  await trace.getByRole('combobox', { name: 'Trace preset' }).selectOption('Line Art');
  await trace.getByRole('checkbox', { name: 'Delete Image After trace' }).uncheck();
  await expect(trace.getByText(/Trace ready/)).toBeVisible({ timeout: 90_000 });
  await trace.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(trace).toBeHidden();
  const first = (await project(page)).scene.objects.find(
    (object) => object.kind === 'traced-image',
  );
  expect(first).toMatchObject({ traceSourceId: source.id });
  await command(page, 'retrace-original');
  await expect(trace.getByRole('checkbox', { name: 'Delete Image After trace' })).not.toBeChecked();
  await expect(trace.getByRole('combobox', { name: 'Trace preset' })).toHaveValue('Line Art');
  await expect(trace.getByText(/Trace ready/)).toBeVisible({ timeout: 90_000 });
  await trace.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(trace).toBeHidden();
  expect(
    (await project(page)).scene.objects.filter((object) => object.kind === 'traced-image'),
  ).toHaveLength(1);
  expect(
    (await project(page)).scene.objects.find((object) => object.kind === 'traced-image')?.id,
  ).toBe(first?.id);
  await kerfdesk.setOpenFiles(
    ['batch-a.png', 'batch-b.png'].map((name) => ({
      name,
      kind: 'png-fixture' as const,
      width: 32,
      height: 32,
    })),
  );
  await command(page, 'multi-file-trace');
  const batch = page.getByRole('dialog', { name: 'Multi-File Trace', exact: true });
  await batch.getByRole('combobox', { name: 'Trace settings' }).selectOption('preset');
  await batch.getByRole('combobox', { name: 'Trace preset' }).selectOption('Line Art');
  await batch.getByRole('button', { name: 'Choose Images...', exact: true }).click();
  await expect(batch).toContainText('2 images chosen.');
  await batch.getByRole('button', { name: 'Trace...', exact: true }).click();
  await expect
    .poll(async () => Object.keys(await kerfdesk.savedFiles()), { timeout: 60_000 })
    .toContain('batch-b-trace.svg');
  for (const name of ['batch-a-trace.svg', 'batch-b-trace.svg']) {
    const saved = (await kerfdesk.savedFiles())[name] ?? '';
    expect(saved).toContain('<svg');
    expect(saved).toContain('<path');
  }
});

test('Bake Variable Text freezes rendered content and Undo restores its template', async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 150, y: 200 } });
  await page.getByRole('textbox', { name: 'Text content on canvas' }).fill('Audit-');
  await page.getByRole('checkbox', { name: 'Variable text' }).check();
  await page.getByRole('button', { name: 'Serial', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await project(page)).scene.objects.length).toBe(1);
  const before = await project(page);
  expect(before.scene.objects[0]).toHaveProperty('variableTemplate');
  await command(page, 'bake-variable-text');
  await expect
    .poll(async () => 'variableTemplate' in ((await project(page)).scene.objects[0] ?? {}))
    .toBe(false);
  expect((await project(page)).scene.objects[0]).toMatchObject({ kind: 'text' });
  await undo(page);
  expect((await project(page)).scene).toEqual(before.scene);
});

test('Convert to Bitmap produces pixels and Undo restores the original vector', async ({
  page,
  kerfdesk,
}) => {
  await openWorkspace(page);
  await kerfdesk.setOpenFiles([
    {
      name: 'audit.svg',
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M0 0H10V10H0Z" fill="black"/></svg>',
    },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect.poll(async () => (await project(page)).scene.objects.length).toBe(1);
  const before = await project(page);
  await command(page, 'convert-to-bitmap');
  const dialog = page.getByRole('dialog', { name: 'Convert to Bitmap', exact: true });
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(dialog).toBeHidden();
  const result = (await project(page)).scene.objects[0];
  expect(result).toMatchObject({ kind: 'raster-image', pixelWidth: 100, pixelHeight: 100 });
  expect(
    result?.kind === 'raster-image' &&
      Buffer.from(result.lumaBase64 ?? '', 'base64').some((value) => value < 255),
  ).toBe(true);
  await undo(page);
  expect((await project(page)).scene).toEqual(before.scene);
});

test.afterEach(async ({ page, kerfdesk }) => {
  await page.screenshot({ path: test.info().outputPath('result.png') });
  expect((await kerfdesk.events()).some((event) => event.kind.startsWith('serial-'))).toBe(false);
});
