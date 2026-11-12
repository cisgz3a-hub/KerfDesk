// How the canvas answers a click, a drag and a right-click, zoomed out and
// zoomed in (annoyance audit A2 fix group G3; ADR-196 Amendment 1).

import { expect, test, type Page } from './fixtures/kerfdesk-test';

// Line squares: `a` and `b` side by side, and a large `frame` with a small
// `inner` square inside it.
// On the top edge of a, clear of its corner and middle handles at both zooms.
const A_TOP_EDGE = { x: 32, y: 20 };
const INNER_MIDDLE = { x: 245, y: 245 };

for (const zoom of [0.6, 6]) {
  test(`a click, a drag and a right-click behave the same at ${zoom}x zoom`, async ({ page }) => {
    // Some thirty round trips to the page: twice the default on a slow runner.
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto('/');
    await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
    await page
      .getByRole('status', { name: 'Machine not set up', exact: true })
      .getByRole('button', { name: 'Not now', exact: true })
      .click();
    await seedScene(page);

    // A click that slips two pixels selects and moves nothing, with snapping on.
    await setView(page, zoom, A_TOP_EDGE);
    const edge = await screen(page, A_TOP_EDGE);
    await page.mouse.move(edge.x, edge.y);
    await page.mouse.down();
    await page.mouse.move(edge.x + 2, edge.y + 1);
    await page.mouse.up();
    expect(await canvasState(page)).toMatchObject({
      selected: ['a'],
      positions: { a: { x: 20, y: 20 } },
      undo: 0,
      dirty: false,
    });

    // The reach of a click on a line is 5 px at any zoom.
    await page.mouse.click(edge.x, edge.y - 8);
    expect((await canvasState(page)).selected).toEqual([]);
    await page.mouse.click(edge.x, edge.y - 3);
    expect((await canvasState(page)).selected).toEqual(['a']);

    // A drag moves by its whole travel, measured from the press. Alt goes
    // down after the press, where it suspends snapping instead of cycling.
    const mmPerPx = await pxToMm(page);
    await page.mouse.move(edge.x, edge.y);
    await page.mouse.down();
    await page.keyboard.down('Alt');
    await page.mouse.move(edge.x + 50, edge.y, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const dragged = await canvasState(page);
    expect(dragged.positions['a']?.x).toBeCloseTo(20 + 50 * mmPerPx, 3);
    expect(dragged.positions['a']?.y).toBeCloseTo(20, 6);
    expect(dragged).toMatchObject({ selected: ['a'], undo: 1 });
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await canvasState(page)).positions['a']?.x).toBe(20);

    // A right-click on one of several selected objects keeps them all.
    await select(page, ['a', 'b']);
    await page.mouse.click(edge.x, edge.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Workspace quick actions', exact: true });
    await expect(menu).toBeVisible();
    expect(await canvasState(page)).toMatchObject({
      selected: ['a', 'b'],
      menu: 'workspace-selection',
    });
    await closeMenu(page);

    // On empty canvas it keeps them too, and opens the empty-canvas menu.
    await page.mouse.click(edge.x, edge.y - 12, { button: 'right' });
    await expect(menu).toBeVisible();
    expect(await canvasState(page)).toMatchObject({
      selected: ['a', 'b'],
      menu: 'workspace-empty',
    });
    await closeMenu(page);

    // On an object that is not selected it selects that object.
    await select(page, ['b']);
    await page.mouse.click(edge.x, edge.y, { button: 'right' });
    await expect(menu).toBeVisible();
    expect(await canvasState(page)).toMatchObject({ selected: ['a'], menu: 'workspace-selection' });
    await closeMenu(page);

    // A plain click on one of several selected objects narrows to it.
    await select(page, ['a', 'b']);
    await page.mouse.click(edge.x, edge.y);
    expect((await canvasState(page)).selected).toEqual(['a']);

    // Inside an outline that is not selected, a drag draws a selection box
    // and a click selects the outline. Neither moves it.
    await select(page, []);
    await setView(page, zoom, INNER_MIDDLE);
    // From below and left of `inner`, dragging right so the box encloses: the
    // Job start marker, a button drawn over the canvas, sits on its top-left corner.
    const from = await screen(page, { x: 226, y: 264 });
    const to = await screen(page, { x: 257, y: 233 });
    await expectOnCanvas(page, from);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    expect((await canvasState(page)).marquee).toBe(true);
    await page.mouse.up();
    const boxed = await canvasState(page);
    expect(boxed).toMatchObject({
      selected: ['inner'],
      positions: { frame: { x: 100, y: 100 } },
      marquee: false,
    });
    expect(boxed.undo).toBe(0);
    await page.mouse.click(from.x, from.y);
    expect(await canvasState(page)).toMatchObject({
      selected: ['frame'],
      positions: { frame: { x: 100, y: 100 } },
    });

    expect(errors).toEqual([]);
  });
}

interface CanvasState {
  readonly selected: readonly string[];
  readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly undo: number;
  readonly dirty: boolean;
  readonly marquee: boolean;
  readonly menu: string | null;
}

async function canvasState(page: Page): Promise<CanvasState> {
  return page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const uiUrl = '/src/ui/state/ui-store.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storeUrl
    )) as typeof import('../src/ui/state');
    const { useUiStore } = (await import(
      /* @vite-ignore */ uiUrl
    )) as typeof import('../src/ui/state/ui-store');
    const state = useStore.getState();
    const ui = useUiStore.getState();
    const selected = new Set(state.additionalSelectedIds);
    if (state.selectedObjectId !== null) selected.add(state.selectedObjectId);
    return {
      selected: [...selected].sort(),
      positions: Object.fromEntries(
        state.project.scene.objects.map((object) => [
          object.id,
          { x: object.transform.x, y: object.transform.y },
        ]),
      ),
      undo: state.undoStack.length,
      dirty: state.dirty,
      marquee: ui.selectionMarquee !== null,
      menu: ui.workspaceContextBar?.context ?? null,
    };
  });
}

async function select(page: Page, ids: readonly string[]): Promise<void> {
  await page.evaluate(async (selection) => {
    const storeUrl = '/src/ui/state/index.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storeUrl
    )) as typeof import('../src/ui/state');
    useStore.getState().selectObjects(selection);
  }, ids);
}

async function closeMenu(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const uiUrl = '/src/ui/state/ui-store.ts';
    const { useUiStore } = (await import(
      /* @vite-ignore */ uiUrl
    )) as typeof import('../src/ui/state/ui-store');
    useUiStore.getState().closeWorkspaceContextBar();
  });
  await expect(
    page.getByRole('menu', { name: 'Workspace quick actions', exact: true }),
  ).toHaveCount(0);
}

/** The press must reach the canvas, not a marker or readout drawn over it. */
async function expectOnCanvas(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<void> {
  const label = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('aria-label') ?? null,
    point,
  );
  expect(label).toBe('KerfDesk workspace');
}

/** Zooms and pans so the scene point sits at the middle of the canvas. */
async function setView(
  page: Page,
  zoom: number,
  centre: { readonly x: number; readonly y: number },
): Promise<void> {
  await page.evaluate(
    async ({ zoomFactor, at }) => {
      const storeUrl = '/src/ui/state/index.ts';
      const uiUrl = '/src/ui/state/ui-store.ts';
      const { useStore } = (await import(
        /* @vite-ignore */ storeUrl
      )) as typeof import('../src/ui/state');
      const { useUiStore } = (await import(
        /* @vite-ignore */ uiUrl
      )) as typeof import('../src/ui/state/ui-store');
      const device = useStore.getState().project.device;
      // Pan is in scene millimetres, applied to a view centred on the bed.
      useUiStore
        .getState()
        .setView(zoomFactor, device.bedWidth / 2 - at.x, device.bedHeight / 2 - at.y);
    },
    { zoomFactor: zoom, at: centre },
  );
  // The canvas repaints and the pointer handlers pick up the view on the next frame.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
}

async function viewOf(page: Page): Promise<{
  readonly left: number;
  readonly top: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly cssPerCanvasPx: number;
}> {
  return page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const uiUrl = '/src/ui/state/ui-store.ts';
    const viewUrl = '/src/ui/workspace/view-transform.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storeUrl
    )) as typeof import('../src/ui/state');
    const { useUiStore } = (await import(
      /* @vite-ignore */ uiUrl
    )) as typeof import('../src/ui/state/ui-store');
    const { computeView } = (await import(
      /* @vite-ignore */ viewUrl
    )) as typeof import('../src/ui/workspace/view-transform');
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label$=" workspace"]');
    if (canvas === null) throw new Error('Workspace canvas missing');
    const device = useStore.getState().project.device;
    const view = computeView(
      canvas.width,
      canvas.height,
      device.bedWidth,
      device.bedHeight,
      useUiStore.getState(),
    );
    const bounds = canvas.getBoundingClientRect();
    return {
      left: bounds.left,
      top: bounds.top,
      scale: view.scale,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
      cssPerCanvasPx: bounds.width / canvas.width,
    };
  });
}

/** Where a scene point is on the page. */
async function screen(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<{ readonly x: number; readonly y: number }> {
  const view = await viewOf(page);
  return {
    x: view.left + (view.offsetX + point.x * view.scale) * view.cssPerCanvasPx,
    y: view.top + (view.offsetY + point.y * view.scale) * view.cssPerCanvasPx,
  };
}

/** Scene millimetres per page pixel. */
async function pxToMm(page: Page): Promise<number> {
  const view = await viewOf(page);
  return 1 / (view.scale * view.cssPerCanvasPx);
}

async function seedScene(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storeUrl = '/src/ui/state/index.ts';
    const sceneUrl = '/src/core/scene/index.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storeUrl
    )) as typeof import('../src/ui/state');
    const { createLayer, IDENTITY_TRANSFORM } = (await import(
      /* @vite-ignore */ sceneUrl
    )) as typeof import('../src/core/scene');
    const square = (id: string, x: number, y: number, size: number) => ({
      kind: 'imported-svg' as const,
      id,
      source: `${id}.svg`,
      transform: { ...IDENTITY_TRANSFORM, x, y },
      bounds: { minX: 0, minY: 0, maxX: size, maxY: size },
      operationIds: ['pointer-line'],
      paths: [
        {
          color: '#4269bb',
          polylines: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: size, y: 0 },
                { x: size, y: size },
                { x: 0, y: size },
              ],
            },
          ],
        },
      ],
    });
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [
            square('a', 20, 20, 40),
            square('b', 20, 80, 40),
            square('frame', 100, 100, 200),
            square('inner', 240, 240, 10),
          ],
          layers: [createLayer({ id: 'pointer-line', name: 'Pointer fixture', color: '#4269bb' })],
        },
      },
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
  });
}
