import { captureMaterialRecipe } from '../src/core/material-library';
import { DEFAULT_DEVICE_PROFILE } from '../src/core/devices';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type Vec2,
} from '../src/core/scene';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../src/io/material-library';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { useMachineInUse } from './fixtures/machine-in-use';
import {
  openRecipeAcceptanceProject,
  recipeAcceptanceSnapshot,
  recipeArtworkPanel,
  recipeHistory,
  recipePanelView,
  saveRecipeAcceptanceProject,
} from './fixtures/process-recipe-acceptance-browser';

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
});

function squareProject(leads: boolean): Project {
  const base = createProject();
  const points = [
    { x: 30, y: 40 },
    { x: 90, y: 40 },
    { x: 90, y: 100 },
    { x: 30, y: 100 },
  ];
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'cut', color: '#ff0000' }),
          power: 90,
          speed: 400,
          ...(leads ? { leadInEnabled: true, leadOutEnabled: true } : {}),
        },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'plate',
          source: 'lead-plate.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 30, minY: 40, maxX: 90, maxY: 100 },
          paths: [
            { color: '#ff0000', polylines: [{ points, closed: true }], operationIds: ['cut'] },
          ],
        },
      ],
    },
  };
}

const library: MaterialLibraryDocument = {
  format: MATERIAL_LIBRARY_FORMAT,
  librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
  libraryId: 'lead-reseed-browser',
  name: 'Lead recipe checks',
  entries: [
    {
      id: 'birch-cut',
      materialName: 'Birch plywood',
      thicknessMm: 3,
      description: 'Birch cut',
      operation: 'cut',
      revision: '1',
      recipe: captureMaterialRecipe({
        ...createLayer({ id: 'cut-preset', color: '#ff0000' }),
        power: 90,
        speed: 400,
      }),
    },
    {
      id: 'birch-fill',
      materialName: 'Birch plywood',
      thicknessMm: 3,
      description: 'Birch engrave',
      operation: 'engrave',
      revision: '1',
      recipe: captureMaterialRecipe({
        ...createLayer({ id: 'fill-preset', color: '#ff0000', mode: 'fill' }),
        power: 35,
        speed: 3000,
      }),
    },
  ],
};

test('led contour start follows an actual mid-edge drag and roundtrips with one Undo', async ({
  page,
  kerfdesk,
}, info) => {
  await openRecipeAcceptanceProject(
    page,
    kerfdesk,
    'led-start.lf2',
    JSON.stringify(squareProject(true)),
  );
  await page.getByRole('button', { name: 'Fit to selection', exact: true }).click();
  const before = await recipeAcceptanceSnapshot(page);
  const handle = page.getByRole('button', { name: 'Job start', exact: true });
  await expect(handle).toHaveAttribute('aria-disabled', 'false');
  const target = await screenPoint(page, { x: 90, y: 70 });
  await dragHandle(page, target, true);
  expect((await recipeAcceptanceSnapshot(page)).project).toEqual(before.project);
  await dragHandle(page, target, false);
  await expect
    .poll(async () => (await recipeAcceptanceSnapshot(page)).project.startPoints?.job)
    .toBeDefined();
  const edited = await recipeAcceptanceSnapshot(page);
  expect(edited.project.startPoints?.job?.x).toBeCloseTo(90, 0);
  expect(edited.project.startPoints?.job?.y).toBeCloseTo(70, 0);
  expect(edited.project.scene).toEqual(before.project.scene);
  expect(edited.undoCount).toBe(before.undoCount + 1);
  await recipeHistory(page, false);
  await expect
    .poll(async () => (await recipeAcceptanceSnapshot(page)).project)
    .toEqual(before.project);
  await recipeHistory(page, true);
  await expect
    .poll(async () => (await recipeAcceptanceSnapshot(page)).project)
    .toEqual(edited.project);
  await page.screenshot({ path: info.outputPath('led-mid-edge-start.png') });
  const saved = await saveRecipeAcceptanceProject(page, kerfdesk);
  await openRecipeAcceptanceProject(page, kerfdesk, 'led-start-reopened.lf2', saved);
  expect((await recipeAcceptanceSnapshot(page)).project.startPoints).toEqual(
    edited.project.startPoints,
  );
  await expectNoSerial(kerfdesk);
});

test('native-arc lead start chosen by pointer agrees with the prepared contour entry', async ({
  page,
  kerfdesk,
}, info) => {
  const machine = { controllerKind: 'grbl-v1.1', origin: 'rear-left' } as const;
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, ...machine });
  // Open keeps the machine in use when the file names the same one (ADR-500
  // Amendment 2), so the native-arc GRBL machine is set up first, as Machine
  // Setup would, and the file then opens on it.
  await useMachineInUse(page, machine);
  const points = Array.from({ length: 129 }, (_, index) => ({
    x: 40 + 10 * Math.cos((index * Math.PI) / 64),
    y: 40 + 10 * Math.sin((index * Math.PI) / 64),
  }));
  const project: Project = {
    ...base,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'cut', color: '#ff0000' }),
          leadInEnabled: true,
          leadOutEnabled: true,
        },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'disc',
          source: 'disc.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 30, minY: 30, maxX: 50, maxY: 50 },
          paths: [{ color: '#ff0000', polylines: [{ closed: true, points }] }],
        },
      ],
    },
  };
  await openRecipeAcceptanceProject(
    page,
    kerfdesk,
    'native-arc-led-start.lf2',
    JSON.stringify(project),
  );
  await page.getByRole('button', { name: 'Fit to selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Job start', exact: true })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  expect((await preparedEntry(page)).native).toBe(true);
  await dragHandle(
    page,
    await screenPoint(page, {
      x: 40 + 10 * Math.cos(Math.PI / 12),
      y: 40 + 10 * Math.sin(Math.PI / 12),
    }),
    false,
  );
  await expect
    .poll(async () => (await recipeAcceptanceSnapshot(page)).project.startPoints?.job)
    .toBeDefined();
  const chosen = (await recipeAcceptanceSnapshot(page)).project.startPoints?.job;
  if (chosen === undefined) throw new Error('Native-arc start was not selected');
  // Native output admits arc move boundaries; the editor must show that same chosen point.
  expect(chosen.x).toBeCloseTo(50, 2);
  expect(chosen.y).toBeCloseTo(40, 2);
  const prepared = await preparedEntry(page);
  expect(prepared.native).toBe(true);
  expect(prepared.join.x).toBeCloseTo(chosen.x, 6);
  expect(prepared.join.y).toBeCloseTo(chosen.y, 6);
  await page.screenshot({ path: info.outputPath('native-arc-lead-start.png') });
  const saved = await saveRecipeAcceptanceProject(page, kerfdesk);
  await openRecipeAcceptanceProject(page, kerfdesk, 'native-arc-led-reopened.lf2', saved);
  expect((await recipeAcceptanceSnapshot(page)).project.startPoints?.job).toEqual(chosen);
  expect((await preparedEntry(page)).join).toEqual(prepared.join);
  await expectNoSerial(kerfdesk);
});

for (const change of ['inactive-leads', 'cleared-optional-settings'] as const) {
  test(`mode reseeds its linked recipe after ${change} and preserves genuine edits`, async ({
    page,
    kerfdesk,
  }, info) => {
    const base = squareProject(false);
    const project: Project = {
      ...base,
      jobSetup: {
        ...base.jobSetup,
        laserMaterial: { name: 'Birch plywood', thicknessMm: 3, autoApplyRecipes: true },
      },
      scene: {
        ...base.scene,
        layers: base.scene.layers.map((layer) => ({
          ...layer,
          ...(change === 'cleared-optional-settings'
            ? { powerMode: 'constant' as const, bidirectionalScanOffsetMm: 0.2 }
            : {}),
        })),
      },
    };
    await openRecipeAcceptanceProject(page, kerfdesk, `${change}.lf2`, JSON.stringify(project));
    await importLibrary(page, kerfdesk);
    await page
      .getByRole('button', { name: 'Apply best recipes to all operations', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await recipeAcceptanceSnapshot(page)).project.scene.layers[0]?.materialBinding?.presetId,
      )
      .toBe('birch-cut');
    const applied = (await recipeAcceptanceSnapshot(page)).project.scene.layers[0];
    if (applied === undefined) throw new Error('Applied operation missing');
    expect(applied.powerMode).toBeUndefined();
    expect(applied.bidirectionalScanOffsetMm).toBeUndefined();
    await recipePanelView(page, 'Properties');
    const panel = recipeArtworkPanel(page);
    if (change === 'inactive-leads') {
      await panel.getByRole('button', { name: /^More cut settings/ }).click();
      const settings = page.getByRole('dialog', { name: /^Cut settings for / });
      await settings.getByLabel('Cut settings enable lead-in', { exact: true }).check();
      await settings.getByLabel('Cut settings lead style', { exact: true }).selectOption('line');
      await settings.getByRole('button', { name: 'Apply settings', exact: true }).click();
      await panel.getByRole('button', { name: /^More cut settings/ }).click();
      await settings.getByLabel('Cut settings enable lead-in', { exact: true }).uncheck();
      await settings.getByRole('button', { name: 'Apply settings', exact: true }).click();
    }
    const beforeMode = await recipeAcceptanceSnapshot(page);
    const mode = panel.getByRole('radiogroup', { name: /^Mode for/ });
    await mode.getByRole('radio', { name: /^Fill/ }).check();
    await expect
      .poll(
        async () =>
          (await recipeAcceptanceSnapshot(page)).project.scene.layers[0]?.materialBinding?.presetId,
      )
      .toBe('birch-fill');
    const filled = await recipeAcceptanceSnapshot(page);
    expect(filled.project.scene.layers[0]).toMatchObject({ mode: 'fill', power: 35, speed: 3000 });
    expect(filled.project.scene.objects).toEqual(beforeMode.project.scene.objects);
    expect(filled.undoCount).toBe(beforeMode.undoCount + 1);
    await page
      .getByRole('group', { name: 'Edit history', exact: true })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect
      .poll(async () => (await recipeAcceptanceSnapshot(page)).project)
      .toEqual(beforeMode.project);
    await page
      .getByRole('group', { name: 'Edit history', exact: true })
      .getByRole('button', { name: 'Redo', exact: true })
      .click();
    await expect
      .poll(async () => (await recipeAcceptanceSnapshot(page)).project)
      .toEqual(filled.project);
    const saved = await saveRecipeAcceptanceProject(page, kerfdesk);
    await openRecipeAcceptanceProject(page, kerfdesk, `${change}-reopened.lf2`, saved);
    expect((await recipeAcceptanceSnapshot(page)).project.scene.layers[0]).toMatchObject({
      mode: 'fill',
      power: 35,
      speed: 3000,
      materialBinding: { presetId: 'birch-fill' },
    });
    const power = panel.getByRole('spinbutton', { name: /^Power for/ });
    await power.fill('47');
    await power.press('Enter');
    await mode.getByRole('radio', { name: /^Line/ }).check();
    expect((await recipeAcceptanceSnapshot(page)).project.scene.layers[0]).toMatchObject({
      mode: 'line',
      power: 47,
      speed: 3000,
    });
    await page.screenshot({ path: info.outputPath(`${change}-preserved-manual-edit.png`) });
    await expectNoSerial(kerfdesk);
  });
}

async function importLibrary(page: Page, fixture: KerfDeskFixture) {
  await recipePanelView(page, 'Materials');
  await fixture.setOpenFiles([{ name: 'lead-reseed.lfml.json', text: JSON.stringify(library) }]);
  await recipeArtworkPanel(page)
    .getByRole('button', { name: 'Open saved libraries', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Saved Libraries', exact: true });
  await dialog.getByRole('button', { name: 'Import library', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByRole('region', { name: 'Material Library', exact: true })
      .getByText('Lead recipe checks', { exact: true }),
  ).toBeVisible();
  const apply = page.getByRole('button', {
    name: 'Apply best recipes to all operations',
    exact: true,
  });
  if (!(await apply.isVisible()))
    await recipeArtworkPanel(page)
      .locator('summary')
      .filter({ hasText: 'Job material & automatic presets' })
      .click();
}

async function dragHandle(page: Page, target: Vec2, cancel: boolean) {
  const handle = page.getByRole('button', { name: 'Job start', exact: true });
  await expect(handle).toHaveAttribute('aria-disabled', 'false');
  const box = await handle.boundingBox();
  if (box === null) throw new Error('Job start is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

async function screenPoint(page: Page, point: Vec2): Promise<Vec2> {
  return page.evaluate(async (point) => {
    const storePath = '/src/ui/state/store.ts';
    const uiPath = '/src/ui/state/ui-store.ts';
    const { useStore } = await import(/* @vite-ignore */ storePath);
    const { useUiStore } = await import(/* @vite-ignore */ uiPath);
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="KerfDesk workspace"]',
    );
    if (canvas === null) throw new Error('Missing workspace canvas');
    const { bedWidth, bedHeight } = useStore.getState().project.device;
    const { zoomFactor, panX, panY } = useUiStore.getState();
    const scale =
      Math.min((canvas.width - 60) / bedWidth, (canvas.height - 60) / bedHeight) * zoomFactor;
    const rect = canvas.getBoundingClientRect();
    return {
      x:
        rect.left +
        (((canvas.width - bedWidth * scale) / 2 + (panX + point.x) * scale) * rect.width) /
          canvas.width,
      y:
        rect.top +
        (((canvas.height - bedHeight * scale) / 2 + (panY + point.y) * scale) * rect.height) /
          canvas.height,
    };
  }, point);
}

async function expectNoSerial(fixture: KerfDeskFixture) {
  expect((await fixture.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
}

async function preparedEntry(page: Page) {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const preparePath = '/src/io/gcode/prepare-output.ts';
    const arcPath = '/src/core/job/cut-arc-moves.ts';
    const contourPath = '/src/core/job/led-contours.ts';
    const devicePath = '/src/core/devices/index.ts';
    const { useStore } = await import(/* @vite-ignore */ storePath);
    const { prepareOutput } = await import(/* @vite-ignore */ preparePath);
    const { validCutArcMoves } = await import(/* @vite-ignore */ arcPath);
    const { jobWithoutLeads } = await import(/* @vite-ignore */ contourPath);
    const { toSceneCoords } = await import(/* @vite-ignore */ devicePath);
    const prepared = prepareOutput(useStore.getState().project);
    if (!prepared.ok) throw new Error('Native-arc fixture did not prepare');
    const cut = prepared.job.groups.find((group: { kind: string }) => group.kind === 'cut')
      ?.segments[0];
    const contour = jobWithoutLeads(prepared.job).groups.find(
      (group: { kind: string }) => group.kind === 'cut',
    )?.segments[0];
    if (cut?.leadContour === undefined || contour === undefined)
      throw new Error('Native-arc lead contour missing');
    const join = cut.polyline[cut.leadContour.from];
    return {
      native: validCutArcMoves(contour) !== null,
      join: toSceneCoords(
        { x: join.x - prepared.jobOriginOffset.x, y: join.y - prepared.jobOriginOffset.y },
        prepared.project.device,
      ) as Vec2,
    };
  });
}
