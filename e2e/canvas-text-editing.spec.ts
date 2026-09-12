import { expect, test } from './fixtures/kerfdesk-test';
import type { Page } from '@playwright/test';
import type { AppState } from '../src/ui/state/store';
import { resolve } from 'node:path';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const url = '/src/ui/state/index.ts';
    const { useStore } = (await import(url)) as { useStore: { getState: () => AppState } };
    const state = useStore.getState();
    return {
      objects: state.project.scene.objects,
      undo: state.undoStack.length,
      redo: state.redoStack.length,
    };
  });
}

async function addText(page: Page, content: string) {
  await page.getByRole('button', { name: 'Text...', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add or edit text' })).toHaveCount(0);
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 180, y: 220 } });
  const input = page.getByRole('textbox', { name: 'Text content on canvas' });
  await expect(input).toBeFocused();
  await input.fill(content);
  return input;
}

test('places and formats multiline text directly on the canvas in one saved undo step', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  const rect = await canvas.boundingBox();
  if (rect === null) throw new Error('Canvas missing');
  const scale = Math.min((rect.width - 48) / 400, (rect.height - 48) / 400);
  const input = await addText(page, 'Made with care\nCafé & Studio');
  await page.getByRole('spinbutton', { name: 'Text size', exact: true }).fill('16');
  await input.click();
  await expect(page.getByRole('region', { name: 'Text formatting' })).toContainText('Live preview');
  expect((await snapshot(page)).objects).toHaveLength(0);
  expect((await snapshot(page)).undo).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('editing.png') });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(input).toHaveCount(0);
  const saved = await snapshot(page);
  expect(saved.objects).toHaveLength(1);
  expect(saved.objects[0]).toMatchObject({
    kind: 'text',
    content: 'Made with care\nCafé & Studio',
    sizeMm: 16,
  });
  expect(saved.objects[0]?.transform.x).toBeCloseTo(
    (180 - (rect.width - 400 * scale) / 2) / scale,
    0,
  );
  expect(saved.objects[0]?.transform.y).toBeCloseTo(
    (220 - (rect.height - 400 * scale) / 2) / scale,
    0,
  );
  expect(saved.undo).toBe(1);
  await page.getByRole('button', { name: 'Save As...', exact: true }).click();
  await expect
    .poll(async () =>
      Object.values(await kerfdesk.savedFiles()).some((file) => file.includes('Made with care')),
    )
    .toBe(true);
  await page.keyboard.press('Control+z');
  expect((await snapshot(page)).objects).toHaveLength(0);
  await page.keyboard.press('Control+Shift+z');
  expect((await snapshot(page)).objects).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('double-click edits the text, Escape cancels, and native keyboard editing stays inside text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  const input = await addText(page, 'Original');
  await input.press('Control+Enter');
  await expect(input).toHaveCount(0);
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  await canvas.dblclick({ position: { x: 194, y: 226 } });
  await expect(input).toHaveValue('Original');
  await input.fill('Cancelled');
  await input.press('Escape');
  expect((await snapshot(page)).objects[0]).toMatchObject({ content: 'Original' });
  await canvas.dblclick({ position: { x: 194, y: 226 } });
  await input.press('Control+a');
  await input.pressSequentially('Edited');
  await input.press('Enter');
  await input.pressSequentially('on canvas');
  await expect(input).toHaveValue('Edited\non canvas');
  expect((await snapshot(page)).objects[0]).toMatchObject({ content: 'Original' });
  await input.press('Control+Enter');
  await expect(input).toHaveCount(0);
  expect((await snapshot(page)).objects[0]).toMatchObject({ content: 'Edited\non canvas' });
  await page.keyboard.press('Control+z');
  expect((await snapshot(page)).objects[0]).toMatchObject({ content: 'Original' });
});

test('curved lettering previews beside its editable content and remains editable after saving', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const input = await addText(page, 'Curved lettering');
  await page.getByRole('spinbutton', { name: 'Text bend', exact: true }).fill('60');
  await input.click();
  await expect(page.getByText('Type in the box beside the live lettering.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Text formatting' })).toContainText('Live preview');
  await page.screenshot({ path: testInfo.outputPath('curved.png') });
  await input.fill('Curved café');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(input).toHaveCount(0);
  expect((await snapshot(page)).objects[0]).toMatchObject({ content: 'Curved café', bendDeg: 60 });
});

test('canvas editing controls fit a 1024px window and an empty draft leaves no artwork', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await addText(page, '');
  const panel = page.getByRole('region', { name: 'Text formatting' });
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(1024);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('compact.png') });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await snapshot(page)).objects).toHaveLength(0);
  expect((await snapshot(page)).undo).toBe(0);
});

test('path text follows a selected guide and retains its linkage on save', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  const rect = await canvas.boundingBox();
  if (rect === null) throw new Error('Canvas missing');
  await page.keyboard.press('Control+r');
  await page.mouse.move(rect.x + 100, rect.y + 100);
  await page.mouse.down();
  await page.mouse.move(rect.x + 400, rect.y + 320, { steps: 5 });
  await page.mouse.up();
  const guide = (await snapshot(page)).objects[0];
  expect(guide?.kind).toBe('shape');
  await addText(page, 'Along the path');
  await page.getByRole('checkbox', { name: 'Path text', exact: true }).check();
  await expect(page.getByRole('region', { name: 'Text formatting' })).toContainText('Live preview');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Text content on canvas' })).toHaveCount(0);
  const text = (await snapshot(page)).objects.find((object) => object.kind === 'text');
  expect(text).toMatchObject({ pathText: { guideObjectId: guide?.id }, content: 'Along the path' });
});

test('font selection and imported fonts work in the canvas session', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  const input = await addText(page, 'Café');
  const picker = page.getByTitle('Open the font picker and choose the text typeface.');
  await picker.click();
  await picker.press('Escape');
  await expect(input).toBeVisible();
  await expect(picker).toHaveAttribute('aria-expanded', 'false');
  await picker.click();
  await page.getByRole('button', { name: /^EMS Nixish/ }).click();
  await expect(page.getByText('Type in the box beside the live lettering.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Text formatting' })).toContainText('Live preview');
  await page
    .getByLabel('Import font file', { exact: true })
    .setInputFiles(resolve('src/ui/text/fonts/Tinos-Regular.ttf'));
  await expect(picker).toContainText('Tinos-Regular.ttf');
  await expect(page.getByText('Type in the box beside the live lettering.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(input).toHaveCount(0);
  const text = (await snapshot(page)).objects[0];
  expect(text).toMatchObject({ content: 'Café' });
  if (text?.kind !== 'text') throw new Error('Text missing');
  expect(text.fontKey).toMatch(/^embedded:/);
});
