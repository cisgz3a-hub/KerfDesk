// Annoyance audit A4-P2-2 and A4-P2-5 (ADR-706), as a keyboard journey in a
// real browser: the design shortcuts keep working after a tick box or slider in
// the Artwork panel was the last thing touched, each control keeps the keys
// that work it, and in Preview the editing keys change nothing and say why.

import { expect, test, type Page } from './fixtures/kerfdesk-test';

test('Undo and Delete work straight after a tick box, with no click on the canvas', async ({
  page,
}) => {
  await openWithTwoRectangles(page);
  const airAssist = page.getByLabel('Air assist for selected operation');
  await expect(airAssist).not.toBeChecked();

  // A real click leaves keyboard focus on the tick box.
  await airAssist.click();
  await expect(airAssist).toBeChecked();
  await expect(airAssist).toBeFocused();

  await page.keyboard.press('Control+z');
  await expect(airAssist).not.toBeChecked();
  expect((await scene(page)).ids).toEqual(['one', 'two']);

  await page.keyboard.press('Control+y');
  await expect(airAssist).toBeChecked();

  // Space still belongs to the tick box.
  await airAssist.focus();
  await page.keyboard.press('Space');
  await expect(airAssist).not.toBeChecked();
  expect((await scene(page)).ids).toEqual(['one', 'two']);

  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).ids).toEqual(['two']);
});

test('a slider keeps its arrow keys, and Delete still reaches the artwork from it', async ({
  page,
}) => {
  await openWithTwoRectangles(page);
  const slider = page.getByLabel('Power slider for selected objects');
  const power = page.getByLabel('Power for selected objects');
  const before = await power.inputValue();

  await slider.focus();
  await page.keyboard.press('ArrowRight');
  // The arrow moved the slider, not the selected rectangle.
  await expect.poll(async () => power.inputValue()).not.toBe(before);
  expect((await scene(page)).oneX).toBe(50);

  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).ids).toEqual(['two']);
});

test('a text or number field keeps Backspace, Delete and its own typing', async ({ page }) => {
  await openWithTwoRectangles(page);
  const passes = page.getByLabel('Passes for selected objects');

  await passes.focus();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await page.keyboard.type('3');
  await expect(passes).toHaveValue(/3/);
  const after = await scene(page);
  expect(after.ids).toEqual(['one', 'two']);
  expect(after.oneX).toBe(50);
});

test('in Preview the editing keys change nothing and one line says why', async ({ page }) => {
  await openWithTwoRectangles(page);
  const selectTool = page.locator(
    'aside[aria-label="Drawing tools"] button[data-help-id="tool:select"]',
  );
  await expect(selectTool).toBeEnabled();

  await page.keyboard.press('p');
  await expect.poll(async () => (await scene(page)).preview).toBe(true);
  await expect(selectTool).toBeDisabled();
  await expect(selectTool).toHaveAttribute('title', /^Not available in Preview\./);

  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('h');
  const inPreview = await scene(page);
  expect(inPreview.ids).toEqual(['one', 'two']);
  expect(inPreview.oneX).toBe(50);
  const hint = page.getByText('Preview shows the job and cannot be edited.', { exact: false });
  await expect(hint.first()).toBeVisible();

  await page.keyboard.press('p');
  await expect.poll(async () => (await scene(page)).preview).toBe(false);
  await expect(hint).toHaveCount(0);
  await expect(selectTool).toBeEnabled();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).ids).toEqual(['two']);
});

async function openWithTwoRectangles(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 20_000 });
  await page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const scenePath = '/src/core/scene/index.ts';
    const shapePath = '/src/core/shapes/primitives/index.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storePath
    )) as typeof import('../src/ui/state/store');
    const { createProject, createLayer, IDENTITY_TRANSFORM } = (await import(
      /* @vite-ignore */ scenePath
    )) as typeof import('../src/core/scene');
    const { createRectangle } = (await import(
      /* @vite-ignore */ shapePath
    )) as typeof import('../src/core/shapes/primitives');
    const color = '#000000';
    const rectangle = (id: string, x: number) =>
      createRectangle({
        id,
        color,
        spec: { widthMm: 30, heightMm: 28, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x, y: 60 },
      });
    const project = createProject();
    useStore.getState().setProject({
      ...project,
      scene: {
        ...project.scene,
        objects: [rectangle('one', 50), rectangle('two', 120)],
        layers: [createLayer({ id: color, color })],
      },
    });
    useStore.getState().selectObject('one');
  });
  await expect(page.getByLabel('Air assist for selected operation')).toBeVisible();
}

async function scene(page: Page): Promise<{
  readonly ids: ReadonlyArray<string>;
  readonly oneX: number | null;
  readonly preview: boolean;
}> {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storePath
    )) as typeof import('../src/ui/state/store');
    const state = useStore.getState();
    const one = state.project.scene.objects.find((object) => object.id === 'one');
    return {
      ids: state.project.scene.objects.map((object) => object.id),
      oneX: one === undefined ? null : one.transform.x,
      preview: state.previewMode,
    };
  });
}
