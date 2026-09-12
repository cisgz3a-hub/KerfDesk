import { expect, test } from './fixtures/kerfdesk-test';
import type { Page } from '@playwright/test';
import type { AppState } from '../src/ui/state/store';

async function savedText(page: Page) {
  return page.evaluate(async () => {
    const moduleUrl = '/src/ui/state/index.ts';
    const { useStore } = (await import(moduleUrl)) as { useStore: { getState: () => AppState } };
    const state = useStore.getState();
    const text = state.project.scene.objects.find((object) => object.kind === 'text');
    if (text?.kind !== 'text') throw new Error('Text missing');
    return { text, undo: state.undoStack.length };
  });
}

test('welds Dancing Script joins, retains editing and saves the setting with undo', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  await page.getByRole('button', { name: 'Text...', exact: true }).click();
  await canvas.click({ position: { x: 180, y: 220 } });
  const input = page.getByRole('textbox', { name: 'Text content on canvas' });
  await input.fill('my');
  await page.getByTitle('Open the font picker and choose the text typeface.').click();
  await page.getByRole('button', { name: /^Dancing Script/ }).click();
  await page.getByRole('spinbutton', { name: 'Text size', exact: true }).fill('100');
  const weld = page.getByRole('checkbox', { name: 'Weld overlapping letters', exact: true });
  await expect(weld).toBeChecked();
  await weld.uncheck();
  await expect(page.getByRole('region', { name: 'Text formatting' })).toContainText('Live preview');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(input).toHaveCount(0);
  const raw = await savedText(page);
  expect(raw.text.weldOverlaps).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('script-before.png') });

  await canvas.dblclick({ position: { x: 194, y: 240 } });
  await expect(input).toHaveValue('my');
  await expect(weld).not.toBeChecked();
  await weld.check();
  await expect(page.getByRole('region', { name: 'Text formatting' })).toContainText('Live preview');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(input).toHaveCount(0);
  const welded = await savedText(page);
  expect(welded.text).toMatchObject({
    kind: 'text',
    content: 'my',
    fontKey: 'dancing-script-regular',
    weldOverlaps: true,
    transform: raw.text.transform,
  });
  expect(welded.text.paths[0]?.polylines.length).toBeLessThan(
    raw.text.paths[0]?.polylines.length ?? 0,
  );
  expect(welded.undo).toBe(raw.undo + 1);
  await page.screenshot({ path: testInfo.outputPath('script-after.png') });
  await page.getByRole('button', { name: 'Save As...', exact: true }).click();
  await expect
    .poll(async () =>
      Object.values(await kerfdesk.savedFiles()).some((file) =>
        file.includes('"weldOverlaps": true'),
      ),
    )
    .toBe(true);
  await page.keyboard.press('Control+z');
  expect((await savedText(page)).text).toEqual(raw.text);
  await page.keyboard.press('Control+Shift+z');
  expect((await savedText(page)).text).toEqual(welded.text);
  await canvas.dblclick({ position: { x: 194, y: 240 } });
  await expect(input).toHaveValue('my');
  await expect(weld).toBeChecked();
  await input.fill('my name');
  await input.press('Control+Enter');
  expect((await savedText(page)).text).toMatchObject({ content: 'my name', weldOverlaps: true });
  expect(errors).toEqual([]);
});
