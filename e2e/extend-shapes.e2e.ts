import { expect, test, type Page } from './fixtures/kerfdesk-test';
import type { AppState } from '../src/ui/state/store';

async function seedScene(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const sceneUrl = '/src/core/scene/index.ts';
    const { useStore } = (await import(storeUrl)) as typeof import('../src/ui/state');
    const { createLayer, IDENTITY_TRANSFORM } = (await import(
      sceneUrl
    )) as typeof import('../src/core/scene');
    const state = useStore.getState();
    const line = (id: string, points: { x: number; y: number }[], locked = false) => ({
      kind: 'imported-svg' as const,
      id,
      source: `${id}.svg`,
      locked,
      transform: IDENTITY_TRANSFORM,
      operationIds: ['extend-cut'],
      bounds: { minX: 40, minY: 40, maxX: 180, maxY: 160 },
      paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
    });
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [
            line('extend-source', [
              { x: 60, y: 100 },
              { x: 100, y: 100 },
            ]),
            line(
              'extend-boundary',
              [
                { x: 160, y: 60 },
                { x: 160, y: 140 },
              ],
              true,
            ),
          ],
          layers: [createLayer({ id: 'extend-cut', name: 'Cut', color: '#000000' })],
        },
      },
      undoStack: [],
      redoStack: [],
      dirty: false,
      selectedObjectId: null,
    });
  });
}

async function endpointScreen(page: Page, x: number, y: number) {
  return page.evaluate(
    async ({ x, y }) => {
      const storeUrl = '/src/ui/state/index.ts';
      const uiUrl = '/src/ui/state/ui-store.ts';
      const viewUrl = '/src/ui/workspace/view-transform.ts';
      const { useStore } = (await import(storeUrl)) as typeof import('../src/ui/state');
      const { useUiStore } = (await import(uiUrl)) as typeof import('../src/ui/state/ui-store');
      const { computeView } = (await import(
        viewUrl
      )) as typeof import('../src/ui/workspace/view-transform');
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="KerfDesk workspace"]',
      );
      if (canvas === null) throw new Error('Workspace canvas missing');
      const box = canvas.getBoundingClientRect();
      const { device } = useStore.getState().project;
      const view = computeView(
        canvas.width,
        canvas.height,
        device.bedWidth,
        device.bedHeight,
        useUiStore.getState(),
      );
      return {
        x: box.left + ((view.offsetX + x * view.scale) * box.width) / canvas.width,
        y: box.top + ((view.offsetY + y * view.scale) * box.height) / canvas.height,
      };
    },
    { x, y },
  );
}

async function summary(page: Page) {
  return page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const { useStore } = (await import(storeUrl)) as { useStore: { getState: () => AppState } };
    const state = useStore.getState();
    return {
      objects: state.project.scene.objects,
      undo: state.undoStack.length,
      dirty: state.dirty,
    };
  });
}

test('Extend previews, commits one endpoint, undoes, and leaves a missing boundary unchanged', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
  await seedScene(page);
  const before = await summary(page);
  const end = await endpointScreen(page, 100, 100);
  await page.mouse.move(end.x, end.y);
  const menu = page.getByRole('menubar', { name: 'Application menu' });
  await menu.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await menu
    .getByRole('menuitem')
    .or(menu.getByRole('menuitemcheckbox'))
    .filter({ has: page.getByText('Extend Shapes', { exact: true }) })
    .click();
  await expect(page.getByTestId('extend-shapes-layer')).toBeVisible();
  await expect(page.getByTestId('extend-shapes-status')).toHaveCount(0);

  await page.mouse.move(end.x, end.y);
  await expect(page.getByTestId('extend-shapes-status')).toContainText('Click to extend');
  expect(await summary(page)).toEqual(before);
  await page.mouse.move(5, 5);
  await expect(page.getByTestId('extend-shapes-status')).toHaveCount(0);
  await page.mouse.move(end.x, end.y);
  await expect(page.getByTestId('extend-shapes-status')).toContainText('Click to extend');
  await page.mouse.click(end.x, end.y);
  const extended = await summary(page);
  const source = extended.objects[0];
  expect(
    source !== undefined && 'paths' in source && source.paths[0]?.polylines[0]?.points.at(-1),
  ).toEqual({ x: 160, y: 100 });
  expect(extended.objects[1]).toEqual(before.objects[1]);
  expect(extended.undo).toBe(1);
  await page.keyboard.press('Control+z');
  expect((await summary(page)).objects).toEqual(before.objects);

  const start = await endpointScreen(page, 60, 100);
  await page.mouse.move(start.x, start.y);
  await expect(page.getByTestId('extend-shapes-status')).toContainText('No boundary ahead');
  const unchanged = await summary(page);
  await page.mouse.click(start.x, start.y);
  expect(await summary(page)).toEqual(unchanged);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('extend-shapes-layer')).toHaveCount(0);
  expect(errors).toEqual([]);
});
