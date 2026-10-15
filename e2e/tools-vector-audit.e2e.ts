import { expect, test as fixtureTest, type Page } from './fixtures/kerfdesk-test';
import { captureSvgCanvas } from './fixtures/composed-svg-canvas';
import type { AppState } from '../src/ui/state/store';
import type { ImportedSvg, Project } from '../src/core/scene';

// Keep the dev renderer's module graph warm between independent scene fixtures.
// Playwright replaces the worker (and this page) after any failed test.
let sharedPage: Page | undefined;
const test = fixtureTest.extend({
  page: async ({ browser }, use) => {
    sharedPage ??= await browser.newPage({ viewport: { width: 1500, height: 950 } });
    await use(sharedPage);
  },
});
test.afterAll(async () => {
  await sharedPage?.close();
});

// Synthetic artwork is only setup. Every command, dialog acceptance, pointer edit
// and Undo below uses the rendered application controls.
type Seed = 'single' | 'pair' | 'open' | 'fill-open' | 'join' | 'joint' | 'optimize' | 'extend';
async function seed(page: Page, kind: Seed): Promise<void> {
  await page.evaluate(async (kind) => {
    const stateUrl = '/src/ui/state/index.ts';
    const sceneUrl = '/src/core/scene/index.ts';
    const uiUrl = '/src/ui/state/ui-store.ts';
    const warpUrl = '/src/ui/state/warp-deform-session.ts';
    const { useUiStore } = await import(uiUrl);
    const { useWarpDeformSession } = await import(warpUrl);
    useUiStore.getState().resetToolMode();
    useWarpDeformSession.getState().setSession(null);
    const { useStore } = (await import(stateUrl)) as {
      useStore: { getState: () => AppState; setState: (value: Partial<AppState>) => void };
    };
    const { createLayer, IDENTITY_TRANSFORM } = await import(sceneUrl);
    const rectangle = (x: number, y: number, w: number, h: number) => ({
      closed: true,
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
        { x, y },
      ],
    });
    const object = (
      id: string,
      polylines: ImportedSvg['paths'][number]['polylines'],
    ): ImportedSvg => ({
      kind: 'imported-svg',
      id,
      source: `${id}.svg`,
      operationIds: ['cut'],
      transform: IDENTITY_TRANSFORM,
      bounds: {
        minX: Math.min(...polylines.flatMap((p) => p.points.map((q) => q.x))),
        minY: Math.min(...polylines.flatMap((p) => p.points.map((q) => q.y))),
        maxX: Math.max(...polylines.flatMap((p) => p.points.map((q) => q.x))),
        maxY: Math.max(...polylines.flatMap((p) => p.points.map((q) => q.y))),
      },
      paths: [{ color: '#000000', polylines }],
    });
    let objects = [object('a', [rectangle(40, 40, 20, 20)])];
    if (kind === 'pair') objects.push(object('b', [rectangle(50, 50, 20, 20)]));
    if (kind === 'open' || kind === 'fill-open')
      objects = [
        object('a', [
          {
            closed: false,
            points: [
              { x: 40, y: 40 },
              { x: 60, y: 40 },
              { x: 60, y: 60 },
              { x: 40, y: 60 },
              { x: 40.05, y: 40 },
            ],
          },
        ]),
      ];
    if (kind === 'join')
      objects = [
        object('a', [
          {
            closed: false,
            points: [
              { x: 40, y: 40 },
              { x: 50, y: 40 },
            ],
          },
        ]),
        object('b', [
          {
            closed: false,
            points: [
              { x: 50.01, y: 40 },
              { x: 60, y: 40 },
            ],
          },
        ]),
      ];
    if (kind === 'joint')
      objects = [object('a', [rectangle(40, 40, 30, 30), rectangle(50, 50, 3, 10)])];
    if (kind === 'optimize')
      objects = [
        object('a', [
          {
            closed: false,
            points: Array.from({ length: 101 }, (_, i) => ({
              x: 40 + i / 5,
              y: 40 + (i % 2) * 0.005,
            })),
          },
        ]),
      ];
    if (kind === 'extend')
      objects = [
        object('a', [
          {
            closed: false,
            points: [
              { x: 40, y: 40 },
              { x: 50, y: 40 },
            ],
          },
        ]),
        object('b', [
          {
            closed: false,
            points: [
              { x: 60, y: 30 },
              { x: 60, y: 50 },
            ],
          },
        ]),
      ];
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects,
          groups: [],
          layers: [
            createLayer({
              id: 'cut',
              name: 'Audit cut',
              color: '#000000',
              mode: kind === 'fill-open' ? 'fill' : 'line',
              output: true,
            }),
          ],
        },
      },
      selectedObjectId: 'a',
      additionalSelectedIds: new Set(objects.slice(1).map((o) => o.id)),
      selectedPathNode: null,
      selectedPathNodes: [],
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
  }, kind);
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const url = '/src/ui/state/index.ts';
    const { useStore } = (await import(url)) as { useStore: { getState: () => AppState } };
    const state = useStore.getState();
    return { scene: state.project.scene, project: state.project, undo: state.undoStack.length };
  });
}

async function command(page: Page, id: string) {
  const menu = page.getByRole('menubar', { name: 'Application menu' });
  await menu.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  const item = menu.locator(`[data-help-id="command:tools.${id}"]`);
  await expect(item).toBeEnabled();
  await item.click();
}

async function point(page: Page, project: Project, x: number, y: number) {
  const viewport = await captureSvgCanvas(page, project);
  const box = await page.getByLabel('KerfDesk workspace', { exact: true }).boundingBox();
  if (box === null) throw new Error('Missing workspace');
  return {
    x: box.x + ((viewport.offsetX + x * viewport.scale) * box.width) / viewport.width,
    y: box.y + ((viewport.offsetY + y * viewport.scale) * box.height) / viewport.height,
  };
}

const cases: readonly { id: string; seed: Seed; dialog?: string; apply?: string }[] = [
  { id: 'convert-to-path', seed: 'single' },
  { id: 'generate-path-from-cut', seed: 'single' },
  { id: 'weld', seed: 'pair', dialog: 'Combine Shapes', apply: 'Apply' },
  { id: 'union-silhouette', seed: 'pair', dialog: 'Union silhouette', apply: 'Union shapes' },
  { id: 'join-paths', seed: 'join', dialog: 'Join paths', apply: 'Join paths' },
  {
    id: 'resize-joints',
    seed: 'joint',
    dialog: 'Resize Joint Openings',
    apply: 'Apply selected openings',
  },
  { id: 'prepare-stamp', seed: 'single', dialog: 'Prepare Stamp', apply: 'Apply as new image' },
  { id: 'offset-shapes', seed: 'single', dialog: 'Offset Shapes', apply: 'Offset' },
  { id: 'rubber-band-outline', seed: 'pair' },
  { id: 'close-paths', seed: 'open' },
  { id: 'reverse-paths', seed: 'open' },
  { id: 'optimize-shapes', seed: 'optimize', dialog: 'Optimize Shapes', apply: 'Optimize' },
  { id: 'warp', seed: 'single' },
  { id: 'deform', seed: 'single' },
  { id: 'subtract', seed: 'pair', dialog: 'Combine Shapes', apply: 'Apply' },
  { id: 'intersect', seed: 'pair', dialog: 'Combine Shapes', apply: 'Apply' },
  { id: 'exclude', seed: 'pair', dialog: 'Combine Shapes', apply: 'Apply' },
  { id: 'cut-shapes', seed: 'pair' },
  { id: 'trim-shapes', seed: 'pair' },
  { id: 'extend-shapes', seed: 'extend' },
  { id: 'fill-selection', seed: 'single' },
  { id: 'close-open-fill-contours', seed: 'fill-open' },
  {
    id: 'close-fill-contours-with-tolerance',
    seed: 'fill-open',
    dialog: 'Close Fill Contours With Tolerance',
    apply: 'Apply Close',
  },
  {
    id: 'close-paths-with-tolerance',
    seed: 'open',
    dialog: 'Close Paths With Tolerance',
    apply: 'Close paths',
  },
  { id: 'radius-fillet', seed: 'single', dialog: 'Radius / Fillet', apply: 'Apply' },
  { id: 'shear', seed: 'single', dialog: 'Shear', apply: 'Shear' },
];

for (const item of cases) {
  test(`Tools ${item.id}: real menu, result and Undo`, async ({ page, kerfdesk }, info) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const onError = (error: Error) => errors.push(error.message);
    page.on('pageerror', onError);
    await page.setViewportSize({ width: 1500, height: 950 });
    if (page.url() === 'about:blank') await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible({
      timeout: 180_000,
    });
    page.setDefaultTimeout(30_000);
    // Successful preceding tests close their dialog/editor. Escape also closes
    // any leftover menu or transient gesture; assert isolation before reseeding.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await seed(page, item.seed);
    const before = await snapshot(page);
    await command(page, item.id);
    if (item.dialog !== undefined) {
      const dialog = page.getByRole('dialog', { name: item.dialog, exact: true });
      await expect(dialog).toBeVisible();
      if (item.id === 'resize-joints') {
        await dialog.getByLabel('Material thickness (mm)', { exact: true }).fill('3.5');
        await dialog.getByRole('checkbox').first().check();
      }
      if (item.id === 'prepare-stamp') {
        await dialog.getByLabel('Vector raster DPI', { exact: true }).fill('127');
        await dialog.getByRole('button', { name: 'Prepare preview', exact: true }).click();
        await dialog
          .getByRole('checkbox', {
            name: 'I reviewed the face, mirroring, dimensions and height map.',
          })
          .check();
      }
      if (item.apply === undefined) throw new Error('Missing dialog acceptance button');
      await dialog.getByRole('button', { name: item.apply, exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    if (item.id === 'warp' || item.id === 'deform') {
      await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
      const corner = await point(page, before.project, 60, 60);
      await page.mouse.move(corner.x, corner.y);
      await page.mouse.down();
      await page.mouse.move(corner.x + 45, corner.y + 20, { steps: 8 });
      await page.mouse.up();
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
    }
    if (item.id === 'trim-shapes' || item.id === 'extend-shapes') {
      await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
      const target = await point(
        page,
        before.project,
        item.id === 'trim-shapes' ? 60 : 50,
        item.id === 'trim-shapes' ? 45 : 40,
      );
      await page.mouse.move(target.x - 15, target.y);
      await page.mouse.move(target.x, target.y, { steps: 4 });
      await page.mouse.click(target.x, target.y);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
    }
    await expect.poll(async () => (await snapshot(page)).undo).toBe(1);
    const after = await snapshot(page);
    expect(after.scene).not.toEqual(before.scene);
    await page.screenshot({ path: info.outputPath(`${item.id}-result.png`) });
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await snapshot(page)).scene).toEqual(before.scene);
    expect(errors).toEqual([]);
    expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual(
      [],
    );
    page.off('pageerror', onError);
  });
}
