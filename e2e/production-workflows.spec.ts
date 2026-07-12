import { expect, test, type Page } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
});

test('creates arrays, nests them, previews them, and saves one undoable project', async ({
  page,
  kerfdesk,
}) => {
  await selectAll(page);
  await runMenuCommand(page, 'Arrange', 'Array...');
  await expect(page.getByRole('dialog', { name: 'Array' })).toBeVisible();
  await page.getByRole('button', { name: 'Create array' }).click();

  await selectAll(page);
  await runMenuCommand(page, 'Arrange', 'Quick Nest...');
  await expect(page.getByRole('dialog', { name: 'Quick Nest' })).toBeVisible();
  await page.getByRole('button', { name: 'Nest selection' }).click();

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(
    page.getByRole('group', { name: 'Preview route controls and statistics' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save As...' }).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.scene.objects.length).toBe(4);
});

test('imports SVG through the real picker and creates a circular array', async ({
  page,
  kerfdesk,
}) => {
  await kerfdesk.setOpenFiles([
    {
      name: 'curve-fixture.svg',
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><path d="M0 10 C10 0 30 20 40 10" fill="none" stroke="#00ff00"/></svg>',
    },
  ]);
  await page.getByRole('button', { name: 'Import SVG...' }).click();
  await selectAll(page);
  await runMenuCommand(page, 'Arrange', 'Array...');
  await page.getByRole('tab', { name: 'Circular' }).click();
  await page.getByRole('button', { name: 'Create array' }).click();
  await page.getByRole('button', { name: 'Save As...' }).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.scene.objects.length).toBeGreaterThan(6);
  expect(JSON.stringify(saved.scene.objects)).toContain('cubic');
});

test('configures chuck rotary and generates its calibration pattern', async ({
  page,
  kerfdesk,
}) => {
  await enableLab(page, 'Rotary setup');
  await runMenuCommand(page, 'Tools', 'Rotary Setup...');
  await page.getByLabel('Enable rotary for this machine profile').check();
  await page.getByRole('button', { name: 'Chuck' }).click();
  await page.getByLabel('Rotary object diameter').fill('80');
  await page.getByLabel('Rotary millimetres per rotation').fill('360');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Generate test pattern' }).click();
  await page.getByRole('button', { name: 'Save As...' }).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.device.rotary).toMatchObject({
    enabled: true,
    type: 'chuck',
    objectDiameterMm: 80,
    mmPerRotation: 360,
  });
  expect(saved.scene.objects).toHaveLength(1);
  expect(saved.scene.objects[0]).toMatchObject({
    id: 'rotary-calibration-pattern',
    source: 'Rotary calibration pattern',
  });
});

test('captures two machine points and persists print-and-cut design targets', async ({
  page,
  kerfdesk,
}) => {
  await enableLab(page, 'Print and Cut');
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect
    .poll(async () =>
      (await kerfdesk.events())
        .filter((event) => event.kind === 'serial-write')
        .map((event) => String(event['text']))
        .join(''),
    )
    .toContain('G4 P0.01');
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
  await runMenuCommand(page, 'Tools', 'Print and Cut...');

  const targetOne = page.getByRole('group', { name: 'Target 1' });
  const targetTwo = page.getByRole('group', { name: 'Target 2' });
  await targetOne.getByRole('spinbutton', { name: 'Design X' }).fill('0');
  await targetOne.getByRole('spinbutton', { name: 'Design Y' }).fill('0');
  await targetTwo.getByRole('spinbutton', { name: 'Design X' }).fill('100');
  await targetTwo.getByRole('spinbutton', { name: 'Design Y' }).fill('0');
  const captureButtons = page.getByRole('button', { name: 'Capture head' });
  await kerfdesk.emitSerialLine('<Idle|MPos:20.000,30.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await captureButtons.nth(0).click();
  await kerfdesk.emitSerialLine('<Idle|MPos:120.000,30.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await captureButtons.nth(1).click();
  await page.getByRole('button', { name: 'Apply registration' }).click();
  await page.getByRole('button', { name: 'Save As...' }).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.printAndCutTargets).toEqual({
    first: { x: 0, y: 0 },
    second: { x: 100, y: 0 },
  });
});

test('imports a CLB library and links its preset to a cut layer', async ({ page, kerfdesk }) => {
  await kerfdesk.setOpenFiles([
    {
      name: 'birch.clb',
      text: '<LightBurnLibrary><Material Name="Birch"><Entry Thickness="3" Desc="Clean cut"><CutSetting Type="Cut" Speed="8" MaxPower="75" MinPower="5" NumPasses="2" AirAssist="1" /></Entry></Material></LightBurnLibrary>',
    },
  ]);
  await page.getByRole('button', { name: 'Open saved libraries' }).click();
  await page.getByRole('button', { name: 'Import LightBurn CLB' }).click();
  await expect(page.getByText('birch', { exact: false }).first()).toBeVisible();

  await expect(page.getByRole('combobox', { name: 'Material library preset' })).toContainText(
    'Birch',
  );
  await page.getByRole('button', { name: 'Link selected material preset to layer' }).click();
  await expect(page.getByText('Layer is linked to the selected material library.')).toBeVisible();
});

test('builds variable text with embedded CSV and serial state', async ({ page, kerfdesk }) => {
  await page.getByRole('button', { name: 'Text...' }).click();
  await page.getByRole('textbox', { name: 'Text content' }).fill('Part-');
  await page.getByRole('checkbox', { name: 'Variable text' }).check();
  await page.getByLabel('Import variable CSV').setInputFiles({
    name: 'parts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,material\nBracket,Birch\nPanel,Acrylic\n'),
  });
  await page.getByRole('button', { name: 'CSV: name' }).click();
  await page.getByRole('button', { name: 'Serial' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add or edit text' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Save As...' }).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.variables?.csv).toMatchObject({
    sourceName: 'parts.csv',
    headers: ['name', 'material'],
    records: [
      ['Bracket', 'Birch'],
      ['Panel', 'Acrylic'],
    ],
  });
  const text = saved.scene.objects.find((object) => object['kind'] === 'text');
  expect(text?.['variableTemplate']).toMatchObject({
    tokens: [
      { kind: 'literal', value: 'Part-' },
      { kind: 'csv', column: 'name' },
      { kind: 'serial', width: 4 },
    ],
  });
});

test('configures the Creality Falcon profile through the complete setup wizard', async ({
  page,
  kerfdesk,
}) => {
  await page.getByRole('button', { name: 'Set up device' }).click();
  await expect(page.getByRole('dialog', { name: 'Device Setup' })).toContainText('Step 1 of 7');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Use Creality Falcon A1 Pro' }).click();
  for (let step = 0; step < 5; step += 1) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Finish setup' })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await page.getByRole('button', { name: 'Save As...' }).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.device).toMatchObject({
    profileId: 'creality-falcon-a1-pro-grblhal',
    controllerKind: 'grblhal',
    bedWidth: 400,
    bedHeight: 400,
    framingFeedMmPerMin: 10000,
  });
});

test('imports a generated bitmap and traces it through the production worker workflow', async ({
  page,
  kerfdesk,
}) => {
  await kerfdesk.setOpenFiles([
    { name: 'trace-square.png', kind: 'png-fixture', width: 64, height: 64 },
  ]);
  await page.getByRole('button', { name: 'Import Image...' }).click();
  await expect(page.getByText('Objects: 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trace Image...' })).toBeEnabled();
  await page.getByRole('button', { name: 'Trace Image...' }).click();
  await expect(page.getByRole('dialog', { name: 'Trace image' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trace', exact: true })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Trace image' })).not.toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Save As...' }).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.scene.objects.some((object) => object['kind'] === 'traced-image')).toBe(true);
  expect(
    saved.scene.objects.some(
      (object) => object['kind'] === 'raster-image' && object['source'] === 'trace-square.png',
    ),
  ).toBe(true);
});

async function selectAll(page: Page): Promise<void> {
  await runMenuCommand(page, 'Edit', 'Select All');
}

async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  await page.getByText(family, { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: command }).click();
}

async function enableLab(page: Page, label: string): Promise<void> {
  await runMenuCommand(page, 'Tools', 'Labs...');
  await page.getByText(label, { exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
}

async function savedProject(kerfdesk: {
  savedFiles: () => Promise<Readonly<Record<string, string>>>;
}): Promise<SavedProject> {
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles()).length).toBeGreaterThan(0);
  const text = Object.values(await kerfdesk.savedFiles())[0];
  expect(text).toBeDefined();
  return JSON.parse(text ?? '{}') as SavedProject;
}

interface SavedProject {
  readonly device: {
    readonly profileId?: string;
    readonly controllerKind?: string;
    readonly bedWidth?: number;
    readonly bedHeight?: number;
    readonly framingFeedMmPerMin?: number;
    readonly rotary?: {
      readonly enabled: boolean;
      readonly type: string;
      readonly objectDiameterMm: number;
      readonly mmPerRotation: number;
    };
  };
  readonly printAndCutTargets?: {
    readonly first: { readonly x: number; readonly y: number };
    readonly second: { readonly x: number; readonly y: number };
  };
  readonly variables?: {
    readonly csv?: {
      readonly sourceName: string;
      readonly headers: readonly string[];
      readonly records: readonly (readonly string[])[];
    };
  };
  readonly scene: { readonly objects: readonly Record<string, unknown>[] };
}
