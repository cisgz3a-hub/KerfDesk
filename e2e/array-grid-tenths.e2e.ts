// Performance audit S6-P2-2: the Grid array's totals show n × the design's size
// to 0.01 mm in 0.1 mm fields. Chrome's step check refused them, so Create
// array did nothing for almost any real selection, with no message in the app.

import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { composedSvgSnapshot } from './fixtures/composed-svg-browser';

async function selectRectangle(page: Page, widthMm: number, heightMm: number): Promise<void> {
  await page.evaluate(
    async ({ width, height }) => {
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
      const plate = createRectangle({
        id: 'plate',
        color,
        spec: { widthMm: width, heightMm: height, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
      });
      const project = createProject();
      useStore.getState().setProject({
        ...project,
        scene: {
          ...project.scene,
          objects: [plate],
          layers: [createLayer({ id: 'layer', color, mode: 'line' })],
        },
      });
      useStore.getState().selectObjects(['plate']);
    },
    { width: widthMm, height: heightMm },
  );
}

test('creates a 2 × 2 grid from a 142 × 110.923 mm selection', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await selectRectangle(page, 142, 110.923);
  await page.getByRole('menuitem', { name: 'Arrange', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Array...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Array', exact: true });
  await expect(dialog.getByLabel('Total height (mm)', { exact: true })).toHaveValue('223.85');
  await expect(dialog.getByRole('status')).toContainText('2 rows of 2');

  await dialog.getByRole('button', { name: 'Create array', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await composedSvgSnapshot(page)).project.scene.objects.length)
    .toBe(4);
});
