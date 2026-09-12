import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../src/core/devices';
import { unrepresentableStrokeProject } from '../src/__fixtures__/vcarve-stroke-geometry';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Polyline,
  type Project,
  type SceneObject,
} from '../src/core/scene';
import { coneRemovedDepth, emittedFeedChords } from '../src/core/cnc/vcarve-removal.test-support';

const color = '#111111';
const bit = { id: 'v90', name: 'V90', kind: 'v-bit' as const, diameterMm: 20, tipAngleDeg: 90 };

test.use({ viewport: { width: 1440, height: 1000 } });

function box(x: number, width: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y: 0 },
      { x: x + width, y: 0 },
      { x: x + width, y: 4 },
      { x, y: 4 },
    ],
  };
}

function fixture(object: SceneObject): string {
  const project = createProject();
  return JSON.stringify({
    ...project,
    jobSetup: { ...project.jobSetup, placement: { startFrom: 'absolute', anchor: 'front-left' } },
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: bit.id, tools: [bit] },
    scene: {
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'carve', color }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            toolId: bit.id,
            vCarveFlatDepthEnabled: false,
            depthPerPassMm: 3,
            vResolutionMm: 0.25,
          },
        },
      ],
    },
  });
}

const cases: readonly {
  name: string;
  object: SceneObject;
  probe: { x: number; y: number };
  filled: boolean;
}[] = [
  {
    name: 'stretched stroke keeps its protected centre',
    object: {
      kind: 'imported-svg',
      id: 'stroke',
      source: 'Library: square outline',
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
      transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40, scaleX: 2 },
      paths: [{ color, strokeWidthMm: 0.5, polylines: [box(0, 4)] }],
    },
    probe: { x: 44, y: 42 },
    filled: false,
  },
  {
    name: 'overlapping text keeps its joined fill',
    object: {
      kind: 'text',
      id: 'text',
      content: 'ab',
      fontKey: 'audit-script',
      sizeMm: 4,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color,
      bounds: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
      transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40 },
      paths: [{ color, polylines: [box(0, 4), box(2, 4)] }],
    },
    probe: { x: 43, y: 42 },
    filled: true,
  },
];

for (const scenario of cases) {
  test(`Convert to Path, save, reload and export: ${scenario.name}`, async ({
    page,
    kerfdesk,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('/');
    await openProject(page, kerfdesk, 'vcarve-source.lf2', fixture(scenario.object));
    const before = await exportGcode(page, kerfdesk);
    await command(page, 'Edit', 'Select All');
    await command(page, 'Tools', 'Convert to Path');
    await page.getByRole('button', { name: 'Save As...' }).click();
    await expect
      .poll(async () =>
        Object.keys(await kerfdesk.savedFiles()).some((name) => name.endsWith('.lf2')),
      )
      .toBe(true);
    const saved = Object.entries(await kerfdesk.savedFiles()).find(([name]) =>
      name.endsWith('.lf2'),
    );
    if (saved === undefined) throw new Error('Converted project was not saved');
    const project = JSON.parse(saved[1]) as Project;
    const object = project.scene.objects[0];
    expect(object?.kind).toBe('imported-svg');
    if (object?.kind !== 'imported-svg') throw new Error('Conversion did not produce a path');
    expect(object.paths[0]).toMatchObject(
      scenario.filled
        ? { fillRule: 'nonzero' }
        : { strokeWidthMm: 0.5, strokeTransform: { a: 2, b: 0, c: 0, d: 1 } },
    );
    await openProject(page, kerfdesk, 'vcarve-converted.lf2', saved[1]);
    await command(page, 'Edit', 'Select All');
    await page.getByRole('button', { name: 'Fit to selection', exact: true }).click();
    const after = await exportGcode(page, kerfdesk);
    const probe = toMachineCoords(scenario.probe, DEFAULT_DEVICE_PROFILE);
    const beforeDepth = coneRemovedDepth(probe, emittedFeedChords(before), 90);
    const afterDepth = coneRemovedDepth(probe, emittedFeedChords(after), 90);
    if (scenario.filled) {
      expect(beforeDepth).toBeGreaterThan(1.8);
      expect(afterDepth).toBeCloseTo(beforeDepth, 3);
    } else {
      expect(beforeDepth).toBe(0);
      expect(afterDepth).toBe(0);
      expect(emittedFeedChords(after).some(([a, b]) => a.z < -0.2 || b.z < -0.2)).toBe(true);
    }
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(
      page.getByRole('group', { name: 'Preview route controls and statistics' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play route preview', exact: true })).toBeEnabled(
      {
        timeout: 30_000,
      },
    );
    await dismissNotifications(page);
    await page.screenshot({
      path: testInfo.outputPath('converted-vcarve-preview.png'),
      fullPage: true,
    });
    await testInfo.attach('converted-project', {
      body: saved[1],
      contentType: 'application/json',
    });
    await testInfo.attach('emitted-gcode', { body: after, contentType: 'text/plain' });
    expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial'))).toEqual(
      [],
    );
    expect(errors).toEqual([]);
  });
}

test('reports unrepresentable stroke geometry without saving partial G-code', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await openProject(
    page,
    kerfdesk,
    'unrepresentable-stroke.lf2',
    JSON.stringify(unrepresentableStrokeProject()),
  );
  await command(page, 'Edit', 'Select All');
  await expect(
    page.getByRole('note').filter({ hasText: 'could not represent the stroke geometry' }),
  ).toBeVisible();
  await command(page, 'File', 'Save G-code...');
  const dialog = page.getByRole('dialog', { name: 'Save G-code' });
  await expect(dialog).toContainText('No final file was selected or modified');
  await expect(dialog.getByRole('button', { name: 'Choose destination…' })).toBeDisabled();
  expect(await kerfdesk.savedFiles()).toEqual({});
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial'))).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('stroke-geometry-error.png'), fullPage: true });
});

async function openProject(
  page: Page,
  kerfdesk: KerfDeskFixture,
  name: string,
  text: string,
): Promise<void> {
  await kerfdesk.setOpenFiles([{ name, text }]);
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(new RegExp(name.replaceAll('.', '\\.')));
  await dismissNotifications(page);
}

async function dismissNotifications(page: Page): Promise<void> {
  const notifications = page.getByRole('button', { name: /^Dismiss .+ notification:/ });
  while (await notifications.count()) await notifications.first().click();
}

async function exportGcode(page: Page, kerfdesk: KerfDeskFixture): Promise<string> {
  const previousCount = (await kerfdesk.events()).filter(
    (event) => event.kind === 'file-saved',
  ).length;
  await command(page, 'File', 'Save G-code...');
  const dialog = page.getByRole('dialog', { name: 'Save G-code' });
  await expect(dialog).toContainText('The complete export is ready.');
  await dialog.getByRole('button', { name: 'Choose destination…' }).click();
  await page
    .getByRole('dialog', { name: 'Choose G-code filename' })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect
    .poll(
      async () => (await kerfdesk.events()).filter((event) => event.kind === 'file-saved').length,
    )
    .toBeGreaterThan(previousCount);
  const saved = Object.entries(await kerfdesk.savedFiles())
    .filter(([name]) => name.endsWith('.gcode'))
    .at(-1);
  if (saved === undefined) throw new Error('Prepared G-code was not saved');
  return saved[1];
}

async function command(page: Page, family: string, name: string): Promise<void> {
  const menu = page.getByRole('menubar', { name: 'Application menu' });
  await menu.getByRole('menuitem', { name: family, exact: true }).click();
  await menu.getByRole('menuitem').filter({ hasText: name }).click();
}
