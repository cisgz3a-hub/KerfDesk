import { expect, test } from './fixtures/kerfdesk-test';
import type { AppState } from '../src/ui/state/store';

const FONTS = [
  ['Great Vibes', 'great-vibes-regular'],
  ['Allura', 'allura-regular'],
  ['Alex Brush', 'alex-brush-regular'],
  ['Parisienne', 'parisienne-regular'],
  ['Pinyon Script', 'pinyon-script-regular'],
  ['Italianno', 'italianno-regular'],
  ['Corinthia', 'corinthia-regular'],
  ['Cinzel Decorative', 'cinzel-decorative-regular'],
] as const;

for (const [name, fontKey] of FONTS) {
  test(`${name} loads, renders welded names and saves editable text`, async ({
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
    await input.fill('Élodie & André');
    await page.getByTitle('Open the font picker and choose the text typeface.').click();
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await page.getByRole('spinbutton', { name: 'Text size', exact: true }).fill('24');
    await expect(page.getByRole('checkbox', { name: 'Weld overlapping letters' })).toBeChecked();
    await expect(page.getByRole('region', { name: 'Text formatting' })).toContainText(
      'Live preview',
    );
    await expect(
      page.getByRole('region', { name: 'Text formatting' }).getByRole('alert'),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(input).toHaveCount(0);
    const saved = await page.evaluate(async () => {
      const moduleUrl = '/src/ui/state/index.ts';
      const { useStore } = (await import(moduleUrl)) as { useStore: { getState: () => AppState } };
      const state = useStore.getState();
      return { text: state.project.scene.objects[0], undo: state.undoStack.length };
    });
    expect(saved.text).toMatchObject({
      kind: 'text',
      content: 'Élodie & André',
      fontKey,
      weldOverlaps: true,
    });
    if (saved.text?.kind !== 'text') throw new Error('Saved text missing');
    const points = saved.text.paths.flatMap((path) =>
      path.polylines.flatMap((line) => line.points),
    );
    expect(points.length).toBeGreaterThan(100);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true,
    );
    expect(saved.undo).toBe(1);
    expect(await page.evaluate((key) => document.fonts.check(`24px "lf2-${key}"`), fontKey)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`${fontKey}.png`) });
    await page.getByRole('button', { name: 'Save As...', exact: true }).click();
    await expect
      .poll(async () =>
        Object.values(await kerfdesk.savedFiles()).some(
          (file) => file.includes(`"fontKey": "${fontKey}"`) && file.includes('Élodie & André'),
        ),
      )
      .toBe(true);
    // Script capitals leave different gaps. Re-enter on an actual contour,
    // rather than assuming a fixed coordinate contains ink in every font.
    const contourPoint = points[Math.floor(points.length / 2)];
    const canvasBounds = await canvas.boundingBox();
    if (contourPoint === undefined || canvasBounds === null) throw new Error('Lettering missing');
    const scale = Math.min((canvasBounds.width - 48) / 400, (canvasBounds.height - 48) / 400);
    await canvas.dblclick({
      position: {
        x:
          (canvasBounds.width - 400 * scale) / 2 +
          (saved.text.transform.x + contourPoint.x) * scale,
        y:
          (canvasBounds.height - 400 * scale) / 2 +
          (saved.text.transform.y + contourPoint.y) * scale,
      },
    });
    await expect(input).toHaveValue('Élodie & André');
    await expect(
      page.getByTitle('Open the font picker and choose the text typeface.'),
    ).toContainText(name);
    await input.fill('Emma & James');
    await input.press('Control+Enter');
    await expect(input).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
