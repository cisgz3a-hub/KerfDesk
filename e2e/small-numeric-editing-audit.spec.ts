import { expect, test, type Page } from './fixtures/kerfdesk-test';
import type { AppState } from '../src/ui/state/store';

async function state(page: Page) {
  return page.evaluate(async () => {
    const url = '/src/ui/state/index.ts';
    const { useStore } = (await import(url)) as { useStore: { getState: () => AppState } };
    const current = useStore.getState();
    return {
      objects: current.project.scene.objects,
      layers: current.project.scene.layers,
      dirty: current.dirty,
      undo: current.undoStack.length,
      epoch: current.projectDocumentEpoch,
    };
  });
}

async function seedImage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const url = '/src/ui/state/index.ts';
    const { useStore } = (await import(url)) as { useStore: { getState: () => AppState } };
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Image fixture missing its canvas context');
    context.fillStyle = 'gray';
    context.fillRect(0, 0, 20, 20);
    useStore.getState().importRasterImage({
      kind: 'raster-image',
      id: 'shared-image',
      source: 'shared-image.png',
      dataUrl: canvas.toDataURL('image/png'),
      pixelWidth: 20,
      pixelHeight: 20,
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        mirrorX: false,
        mirrorY: false,
      },
      color: '#808080',
      dither: 'floyd-steinberg',
      linesPerMm: 10,
      brightness: 0,
      contrast: 0,
      gamma: 1,
    });
    useStore.getState().setProject(structuredClone(useStore.getState().project));
  });
  await page
    .getByRole('tablist', { name: 'Edit artwork or operation', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true })
    .click();
}

for (const [label, property, text, original] of [
  ['Brightness', 'brightness', '38', 0],
  ['Contrast', 'contrast', '-24', 0],
  ['Gamma', 'gamma', '2.25', 1],
] as const) {
  test(`replacing a document with reused image IDs cancels the pending ${label} edit`, async ({
    page,
    kerfdesk,
  }) => {
    await seedImage(page);
    const input = page.getByRole('spinbutton', { name: `${label} for shared-image.png` });
    await input.fill(text);
    // Exercise the same setProject boundary used by async file completion and
    // remote editor changes while the old field still has a pending timer.
    await page.evaluate(async () => {
      const url = '/src/ui/state/index.ts';
      const { useStore } = (await import(url)) as { useStore: { getState: () => AppState } };
      useStore.getState().setProject(structuredClone(useStore.getState().project));
    });
    await page.waitForTimeout(650);
    await expect(input).toHaveValue(String(original));
    const current = await state(page);
    expect(current.objects[0]).toMatchObject({ [property]: original });
    expect(current.dirty).toBe(false);
    expect(current.undo).toBe(0);
    expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
  });
}

test('an externally restored power value clears the native invalid flag while the input remains focused', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  const input = page.getByRole('spinbutton', { name: /^Power for/ });
  await input.fill('1e2');
  await expect(input).toBeFocused();
  expect(await input.evaluate((element: HTMLInputElement) => element.validity.customError)).toBe(
    true,
  );
  await page.evaluate(async () => {
    const url = '/src/ui/state/index.ts';
    const { useStore } = (await import(url)) as { useStore: { getState: () => AppState } };
    const current = useStore.getState();
    const operation = current.project.scene.layers[0];
    if (operation === undefined) throw new Error('Power fixture missing operation');
    current.setLayerParam(operation.id, { power: 47 });
  });
  await expect(input).toHaveValue('47');
  await expect(input).toBeFocused();
  expect(await input.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(true);
  await input.fill('37.5');
  await input.press('Tab');
  expect((await state(page)).layers[0]?.power).toBe(37.5);
});

test('signed text spacing accepts a minus-first draft through a pause and deleting its first character', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 180, y: 220 } });
  await page.getByRole('textbox', { name: 'Text content on canvas' }).fill('Numeric audit');
  const input = page.getByRole('spinbutton', { name: 'Text letter spacing', exact: true });
  await input.focus();
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await input.pressSequentially('-');
  await page.waitForTimeout(650);
  await input.pressSequentially('0.25');
  await expect(input).toHaveValue('-0.25');
  await input.press('Home');
  await input.press('Delete');
  await expect(input).toHaveValue('0.25');
  await input.press('Tab');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Text content on canvas' })).toHaveCount(0);
  expect((await state(page)).objects[0]).toMatchObject({ kind: 'text', letterSpacing: 0.25 });
});

test('decimal text line height can be entered with a leading point and survives Escape cancellation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 180, y: 220 } });
  const text = page.getByRole('textbox', { name: 'Text content on canvas' });
  await text.fill('Cancelled numeric draft');
  const input = page.getByRole('spinbutton', { name: 'Text line height', exact: true });
  await input.fill('');
  await input.pressSequentially('.');
  await page.waitForTimeout(650);
  await input.pressSequentially('75');
  await input.press('Tab');
  await expect(input).toHaveValue('0.75');
  await text.press('Escape');
  expect((await state(page)).objects).toHaveLength(0);
  expect((await state(page)).undo).toBe(0);
});
