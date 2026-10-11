import { expect, test, type Page } from './fixtures/kerfdesk-test';
import type { AppState } from '../src/ui/state/store';

async function seedTangentScene(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const sceneUrl = '/src/core/scene/index.ts';
    const { useStore } = (await import(storeUrl)) as typeof import('../src/ui/state');
    const { createLayer, flattenCurveSubpath, IDENTITY_TRANSFORM } = (await import(
      sceneUrl
    )) as typeof import('../src/core/scene');
    // x(t)=10t, y(t)=(t-.3)^2 touches the line at x=3, between sampled vertices.
    const curve = {
      start: { x: 0, y: 0.09 },
      closed: false,
      segments: [
        {
          kind: 'cubic' as const,
          control1: { x: 10 / 3, y: -0.11 },
          control2: { x: 20 / 3, y: 0.09 - 0.4 + 1 / 3 },
          to: { x: 10, y: 0.49 },
        },
      ],
    };
    const flat = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
    if (flat.kind !== 'ok') throw new Error('Tangent fixture must flatten');
    const common = {
      kind: 'imported-svg' as const,
      // Make the fixture visible without changing its local curve or tangent parameter.
      transform: { ...IDENTITY_TRANSFORM, x: 60, y: 100, scaleX: 12, scaleY: 120 },
      operationIds: ['trim-cut'],
      bounds: { minX: 0, minY: -0.11, maxX: 10, maxY: 0.49 },
    };
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [
            {
              ...common,
              id: 'trim-source',
              source: 'line.svg',
              paths: [
                {
                  color: '#000000',
                  polylines: [
                    {
                      closed: false,
                      points: [
                        { x: 0, y: 0 },
                        { x: 10, y: 0 },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              ...common,
              id: 'trim-boundary',
              source: 'tangent.svg',
              paths: [{ color: '#000000', polylines: [flat.polyline], curves: [curve] }],
            },
          ],
          layers: [createLayer({ id: 'trim-cut', name: 'Cut', color: '#000000' })],
        },
      },
      undoStack: [],
      redoStack: [],
      dirty: false,
      selectedObjectId: null,
    });
  });
}

async function linePointScreen(page: Page, localX: number) {
  return page.evaluate(async (localX) => {
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
      x: box.left + ((view.offsetX + (60 + 12 * localX) * view.scale) * box.width) / canvas.width,
      y: box.top + ((view.offsetY + 100 * view.scale) * box.height) / canvas.height,
    };
  }, localX);
}

async function summary(page: Page) {
  return page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const { useStore } = (await import(storeUrl)) as { useStore: { getState: () => AppState } };
    const state = useStore.getState();
    return {
      objects: state.project.scene.objects,
      undo: state.undoStack.length,
      redo: state.redoStack.length,
      dirty: state.dirty,
    };
  });
}

async function highlightAlpha(page: Page, point: { x: number; y: number }) {
  return page.getByTestId('trim-shapes-layer').evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((point.x - rect.left) * canvas.width) / rect.width);
    const y = Math.round(((point.y - rect.top) * canvas.height) / rect.height);
    return canvas.getContext('2d')?.getImageData(x, y, 1, 1).data[3] ?? 0;
  }, point);
}

test('Trim previews an exact tangent cut, preserves the boundary, and supports Undo/Redo', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
  await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
  await seedTangentScene(page);
  const before = await summary(page);
  const menu = page.getByRole('menubar', { name: 'Application menu' });
  await menu.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await menu
    .getByRole('menuitem')
    .or(menu.getByRole('menuitemcheckbox'))
    .filter({ has: page.getByText('Trim Shapes', { exact: true }) })
    .click();
  await expect(page.getByTestId('trim-shapes-layer')).toBeVisible();
  const pick = await linePointScreen(page, 1);
  const tangent = await linePointScreen(page, 3);
  const keptPoint = await linePointScreen(page, 6);
  await page.mouse.move(pick.x, pick.y);
  await expect.poll(() => highlightAlpha(page, pick)).toBeGreaterThan(0);
  await expect.poll(() => highlightAlpha(page, tangent)).toBeGreaterThan(0);
  expect(await highlightAlpha(page, keptPoint)).toBe(0);
  expect(await summary(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('tangent-hover.png') });

  await page.mouse.click(pick.x, pick.y);
  await expect.poll(async () => (await summary(page)).undo).toBe(1);
  const after = await summary(page);
  expect(after.objects).toHaveLength(2);
  const source = after.objects.find((object) => object.id === 'trim-source');
  if (source === undefined || !('paths' in source)) throw new Error('Trimmed source missing');
  expect(source.paths).toHaveLength(1);
  expect(source.paths[0]?.polylines).toHaveLength(1);
  const points = source.paths[0]?.polylines[0]?.points;
  expect(points).toHaveLength(2);
  expect(points?.[0]?.x).toBeCloseTo(3, 7);
  expect(points?.[0]?.y).toBeCloseTo(0, 7);
  expect(points?.[1]).toEqual({ x: 10, y: 0 });
  expect(after.objects[1]).toEqual(before.objects[1]);
  expect(after.dirty).toBe(true);
  expect(after.redo).toBe(0);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: testInfo.outputPath('tangent-trimmed.png') });

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await summary(page)).objects).toEqual(before.objects);
  expect((await summary(page)).redo).toBe(1);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await summary(page)).objects).toEqual(after.objects);
  expect((await summary(page)).undo).toBe(1);
  expect((await summary(page)).redo).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('trim-shapes-layer')).toHaveCount(0);
  expect(errors).toEqual([]);
});
