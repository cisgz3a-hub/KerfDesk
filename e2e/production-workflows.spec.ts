import {
  expandMachineUtilities,
  selectWorkspacePanel,
  toolbarCommand,
} from './fixtures/workspace-ui';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await dismissNotifications(page);
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
  await expect(page.getByRole('button', { name: 'Outline', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Nest selection' }).click();

  await (await toolbarCommand(page, 'Preview')).click();
  await expect(
    page.getByRole('group', { name: 'Preview route controls and statistics' }),
  ).toBeVisible();
  await (await toolbarCommand(page, 'Save As...')).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.scene.objects.length).toBe(4);
});

test('calibrates machine timing and exposes cut and travel estimates in Preview', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  await page.getByRole('button', { name: 'Go to step 2: Essentials', exact: true }).click();
  await page.getByText('Accessories and calibration', { exact: true }).click();
  await page.getByText('Planner and time estimate', { exact: true }).click();
  await fillAndCommit(page, 'Estimated cut time scale', '1.18');
  await fillAndCommit(page, 'Estimated travel time scale', '1.07');
  await page.getByRole('button', { name: 'Go to step 3: Review & save', exact: true }).click();
  await page.getByRole('button', { name: 'Save machine setup', exact: true }).click();

  await (await toolbarCommand(page, 'Preview')).click();
  const panel = page.getByRole('group', { name: 'Preview route controls and statistics' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Cut time');
  await expect(panel).toContainText('Travel time');
  await panel.screenshot({ path: testInfo.outputPath('calibrated-preview-timing.png') });

  await (await toolbarCommand(page, 'Save As...')).click();
  const saved = await savedProject(kerfdesk);
  expect(saved.device).toMatchObject({
    estimateCutTimeScale: 1.18,
    estimateTravelTimeScale: 1.07,
  });
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('outline-nests complementary vector parts that rectangular bounds cannot fit', async ({
  page,
  kerfdesk,
}) => {
  await kerfdesk.setOpenFiles([{ name: 'outline-nest.lf2', text: outlineNestProjectFixture() }]);
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/outline-nest\.lf2/);
  await selectAll(page);
  await runMenuCommand(page, 'Arrange', 'Quick Nest...');
  await page.getByRole('spinbutton', { name: 'Part spacing (mm)' }).fill('0');
  await page.getByRole('button', { name: 'Nest selection' }).click();
  await (await toolbarCommand(page, 'Save As...')).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.scene.objects).toHaveLength(2);
  expect(saved.scene.objects.map((object) => object['transform'])).toEqual([
    expect.objectContaining({ x: 0, y: 0 }),
    expect.objectContaining({ x: 0, y: 0 }),
  ]);
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
  await (await toolbarCommand(page, 'Import...')).click();
  await selectAll(page);
  await runMenuCommand(page, 'Arrange', 'Array...');
  await page.getByRole('tab', { name: 'Circular' }).click();
  await page.getByRole('button', { name: 'Create array' }).click();
  await (await toolbarCommand(page, 'Save As...')).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.scene.objects.length).toBeGreaterThan(6);
  expect(JSON.stringify(saved.scene.objects)).toContain('cubic');
});

test('configures chuck rotary and generates its calibration pattern', async ({
  page,
  kerfdesk,
}) => {
  await runMenuCommand(page, 'Tools', 'Rotary Setup...');
  await page.getByLabel('Enable rotary for this machine profile').check();
  await page.getByRole('button', { name: 'Chuck' }).click();
  await page.getByLabel('Rotary object diameter').fill('80');
  await page.getByLabel('Rotary millimetres per rotation').fill('360');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Generate test pattern' }).click();
  await (await toolbarCommand(page, 'Save As...')).click();

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

test('exports rotary raster through the configured machine-space transform', async ({
  page,
  kerfdesk,
}) => {
  await runMenuCommand(page, 'Tools', 'Rotary Setup...');
  await page.getByLabel('Enable rotary for this machine profile').check();
  await page.getByRole('button', { name: 'Chuck' }).click();
  await page.getByLabel('Rotary object diameter').fill('80');
  await page.getByLabel('Rotary millimetres per rotation').fill('360');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();

  await kerfdesk.setOpenFiles([
    { name: 'rotary-raster.png', kind: 'png-fixture', width: 16, height: 16 },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await runMenuCommand(page, 'File', 'Save G-code...');
  await choosePreparedGcodeDestination(page);

  const gcode = await savedText(kerfdesk, '.gcode');
  const yValues = [...gcode.matchAll(/Y(-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  expect(gcode).toContain('G21');
  expect(yValues.length).toBeGreaterThan(2);
  expect(Math.min(...yValues)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...yValues)).toBeGreaterThan(30);
});

test('gates camera bed alignment behind Labs and homing capability', async ({ page }) => {
  await (await toolbarCommand(page, 'Camera')).click();
  const align = page.getByRole('button', { name: 'Align to bed…' });
  await expect(align).toBeDisabled();
  await expect(align).toHaveAttribute('title', /Tools > Labs/);

  await enableLab(page, 'Camera alignment v2');
  await expect(align).toBeEnabled();
  await page.getByRole('button', { name: 'Start USB camera' }).click();
  await align.click();
  await expect(page.getByText('Align camera to bed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Markers already burned' }).click();
  await expect(page.getByRole('button', { name: 'Detect markers' })).toBeEnabled();
});

test('uses one print-and-cut transform for export and invalidates it on trust loss', async ({
  page,
  kerfdesk,
}) => {
  await enableLab(page, 'Print and Cut');
  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Info: Machine settings detected:/)).toBeVisible();
  await expandMachineUtilities(page);
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
  await kerfdesk.emitSerialLine('<Idle|MPos:20.000,270.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await captureButtons.nth(0).click();
  await kerfdesk.emitSerialLine('<Idle|MPos:120.000,270.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await captureButtons.nth(1).click();
  await page.getByRole('button', { name: 'Apply registration' }).click();

  await runMenuCommand(page, 'File', 'Save G-code...');
  await choosePreparedGcodeDestination(page);
  const gcode = await savedText(kerfdesk, '.gcode');
  expect(gcode).toContain('X30.000');
  // Design Y=10 is registered to machine Y=40; front-left output then maps
  // that bed coordinate to controller Y=300-40=260.
  expect(gcode).toContain('Y260.000');

  await page.getByRole('button', { name: /^Disconnect/ }).click();
  await expect(
    page.getByTitle('Print-and-Cut registration is not valid. Capture both machine points again.'),
  ).toBeVisible();
  const savedBefore = fileSavedCount(await kerfdesk.events());
  let blockedMessage = '';
  page.once('dialog', (dialog) => {
    blockedMessage = dialog.message();
    void dialog.dismiss();
  });
  await runMenuCommand(page, 'File', 'Save G-code...');
  await expect.poll(() => blockedMessage).toContain('registration is not valid');
  expect(fileSavedCount(await kerfdesk.events())).toBe(savedBefore);
  const failedSave = page.getByRole('dialog', { name: 'Save G-code' });
  await expect(failedSave).toContainText('No final file was selected or modified');
  await failedSave.getByRole('button', { name: 'Cancel', exact: true }).click();

  await (await toolbarCommand(page, 'Save As...')).click();

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
  await page.getByRole('tab', { name: 'Materials' }).click();
  await page.getByRole('button', { name: 'Open saved libraries' }).click();
  await page.getByRole('button', { name: 'Import LightBurn CLB' }).click();
  await expect(page.getByText('birch', { exact: false }).first()).toBeVisible();

  await expect(page.getByRole('combobox', { name: 'Material library preset' })).toContainText(
    'Birch',
  );
  await page.getByRole('button', { name: 'Link selected material preset to layer' }).click();
  await expect(page.getByText('Linked preset to layer.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Linked preset is current at revision/)).toBeVisible();
});

test('builds bounded variable text sequences with wrap, reverse, and reset', async ({
  page,
  kerfdesk,
}) => {
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 150, y: 200 } });
  await page.getByRole('textbox', { name: 'Text content on canvas' }).fill('Part-');
  await page.getByRole('checkbox', { name: 'Variable text' }).check();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import CSV...' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'parts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,material\nBracket,Birch\nPanel,Acrylic\n'),
  });
  await page.getByRole('button', { name: 'CSV: name' }).click();
  await page.getByRole('button', { name: 'Serial' }).click();
  await page.getByRole('spinbutton', { name: 'Variable serial start' }).fill('100');
  await expect(
    page.getByRole('spinbutton', { name: 'Variable serial', exact: true }),
  ).toHaveAttribute('min', '0');
  await page.getByRole('checkbox', { name: 'Wrap serial' }).check();
  await page.getByRole('spinbutton', { name: 'Variable serial end' }).fill('101');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Variable record', exact: true })).toHaveValue(
    '1',
  );
  await expect(page.getByRole('spinbutton', { name: 'Variable serial', exact: true })).toHaveValue(
    '100',
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Variable record', exact: true })).toHaveValue(
    '2',
  );
  await expect(page.getByRole('spinbutton', { name: 'Variable serial', exact: true })).toHaveValue(
    '101',
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Variable record', exact: true })).toHaveValue(
    '1',
  );
  await expect(page.getByRole('spinbutton', { name: 'Variable serial', exact: true })).toHaveValue(
    '100',
  );
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Variable record', exact: true })).toHaveValue(
    '2',
  );
  await expect(page.getByRole('spinbutton', { name: 'Variable serial', exact: true })).toHaveValue(
    '101',
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Text formatting' })).not.toBeVisible();
  await (await toolbarCommand(page, 'Save As...')).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.variables?.csv).toMatchObject({
    sourceName: 'parts.csv',
    headers: ['name', 'material'],
    records: [
      ['Bracket', 'Birch'],
      ['Panel', 'Acrylic'],
    ],
  });
  expect(saved.variables).toMatchObject({
    recordIndex: 1,
    serialValue: 101,
    sequence: {
      recordStartIndex: 0,
      recordEndIndex: 1,
      serialStartValue: 100,
      serialEndValue: 101,
      advanceBy: 1,
    },
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Machine', exact: true }).click();
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Machine Setup' });
  await expect(setup).toContainText('Step 1 of 3');
  await setup.getByText('Controller and connection settings', { exact: true }).click();
  await setup.getByLabel('Controller firmware').selectOption('grblhal');
  await setup.getByLabel('Search machine profiles').fill('Creality Falcon A1 Pro');
  await page.getByRole('button', { name: 'Use Creality Falcon A1 Pro' }).click();
  await setup.getByRole('button', { name: 'Check essentials', exact: true }).click();
  await setup.getByRole('button', { name: 'Review setup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save machine setup' })).toBeEnabled();
  const finishBox = await page.getByRole('button', { name: 'Save machine setup' }).boundingBox();
  expect(finishBox).not.toBeNull();
  expect((finishBox?.x ?? 0) + (finishBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((finishBox?.y ?? 0) + (finishBox?.height ?? 0)).toBeLessThanOrEqual(844);
  await page.getByRole('button', { name: 'Save machine setup' }).click();
  await (await toolbarCommand(page, 'Save As...')).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.device).toMatchObject({
    profileId: 'creality-falcon-a1-pro-grblhal',
    controllerKind: 'grblhal',
    controllerCommandSet: 'creality-falcon-a1-pro',
    bedWidth: 358,
    bedHeight: 268,
    framingFeedMmPerMin: 10000,
  });
});

test('keeps detected firmware, catalog profile, and streaming transport coherent', async ({
  page,
  kerfdesk,
}) => {
  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await kerfdesk.emitSerialLine("Grbl 1.1h ['$' for help]");

  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Machine Setup' });
  await setup.getByText('Controller and connection settings', { exact: true }).click();
  await expect(setup.getByLabel('Controller firmware')).toHaveValue('grbl-v1.1');

  // A firmware mismatch informs on the card but never disables it — the
  // catalog stays guard-free (rule 7); detection is advisory only.
  await setup.getByLabel('Search machine profiles').fill('Generic Marlin laser');
  const marlinCard = page.locator('article').filter({ hasText: 'Generic Marlin laser 300' });
  await expect(marlinCard).toContainText('Profile controller is marlin, but detected grbl-v1.1.');
  await expect(
    marlinCard.getByRole('button', { name: 'Use Generic Marlin laser 300×200' }),
  ).toBeEnabled();

  await setup.getByLabel('Search machine profiles').fill('xTool D1 Pro');
  await page.getByRole('button', { name: 'Use xTool D1 Pro (20 W)', exact: true }).click();
  await setup.getByRole('button', { name: 'Check essentials', exact: true }).click();
  await setup.getByRole('button', { name: 'Review setup', exact: true }).click();
  await setup.getByRole('button', { name: 'Save machine setup' }).click();
  await (await toolbarCommand(page, 'Save As...')).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.device).toMatchObject({
    profileId: 'xtool-d1-pro',
    controllerKind: 'grbl-v1.1',
    streamingMode: 'char-counted',
    rxBufferBytes: 120,
    gcodeDialect: { dialectId: 'grbl-dynamic' },
  });
});

test('imports a generated bitmap and traces it through the production worker workflow', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await kerfdesk.setOpenFiles([
    { name: 'trace-square.png', kind: 'png-fixture', width: 64, height: 64 },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByText('Objects: 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trace Image...' })).toBeEnabled();
  await page.getByRole('button', { name: 'Trace Image...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await expect(dialog).toBeVisible();
  // This workflow explicitly retains the bitmap; deletion is the dialog default.
  await dialog.getByRole('checkbox', { name: 'Delete Image After trace' }).uncheck();
  const detection = dialog.getByRole('combobox', { name: 'Trace detection' });
  const threshold = dialog.getByRole('spinbutton', { name: 'Trace Threshold', exact: true });
  await expect(detection).toHaveValue('preset');
  await expect(threshold).toHaveCount(0);
  await expect(dialog.getByRole('spinbutton', { name: 'Remove ink specks' })).toHaveValue('12');
  await expect(dialog.getByRole('spinbutton', { name: 'Ignore Less Than' })).toHaveValue('2');
  await dialog.screenshot({ path: testInfo.outputPath('trace-automatic.png') });

  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Sharp');
  await expect(threshold).toHaveCount(0);
  await expect(dialog.getByRole('spinbutton', { name: 'Remove ink specks' })).toHaveValue('1');
  await expect(dialog.getByRole('spinbutton', { name: 'Ignore Less Than' })).toHaveValue('0');
  await detection.selectOption('manual');
  await expect(threshold).toHaveValue('128');
  await threshold.fill('137');
  await expect(threshold).toHaveValue('137');
  await dialog.screenshot({ path: testInfo.outputPath('trace-manual.png') });
  await detection.selectOption('preset');
  await expect(threshold).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Trace preset' }).selectOption('Line Art');
  await expect(page.getByRole('button', { name: 'Trace', exact: true })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Trace image' })).not.toBeVisible({
    timeout: 30_000,
  });
  await (await toolbarCommand(page, 'Save As...')).click();

  const saved = await savedProject(kerfdesk);
  expect(saved.scene.objects.some((object) => object['kind'] === 'traced-image')).toBe(true);
  expect(
    saved.scene.objects.some(
      (object) => object['kind'] === 'raster-image' && object['source'] === 'trace-square.png',
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('frames, pauses, resumes, alarms, stops, and homes back to a safe ready state', async ({
  page,
  kerfdesk,
}) => {
  await connectAndHome(page, kerfdesk);

  await kerfdesk.setAutoAcknowledge(false);
  const frameBaselineLines = serialWriteLineCount(await kerfdesk.events());
  const frameBaselineCharacters = serialWrites(await kerfdesk.events()).length;
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect
    .poll(async () => serialWriteLineCount(await kerfdesk.events()))
    .toBeGreaterThan(frameBaselineLines);
  await kerfdesk.acknowledgeSerial(1);
  await expect(page.getByRole('button', { name: 'ABORT MOTION', exact: true })).toBeVisible();
  await drainHeldFrameWrites(page, kerfdesk, frameBaselineLines + 1, frameBaselineCharacters);
  expect(absoluteXyJogWrites(await kerfdesk.events(), frameBaselineCharacters).slice(0, 5)).toEqual(
    [
      '$J=G90 G21 X10.000 Y270.000 F6000\n',
      '$J=G90 G21 X30.000 Y270.000 F6000\n',
      '$J=G90 G21 X30.000 Y290.000 F6000\n',
      '$J=G90 G21 X10.000 Y290.000 F6000\n',
      '$J=G90 G21 X10.000 Y270.000 F6000\n',
    ],
  );
  await kerfdesk.setAutoAcknowledge(true);
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('button', { name: 'Start framed job', exact: true })).toBeEnabled();
  await dismissNotifications(page);

  await kerfdesk.setAutoAcknowledge(false);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const pauseBytesBefore = serialWriteBytes(await kerfdesk.events()).length;
  await page.getByRole('button', { name: 'Pause' }).click();
  await expectRealtimeCommandThenStatusQuery(kerfdesk, pauseBytesBefore, 0x84);
  await kerfdesk.emitSerialLine(
    '<Door:0|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>',
  );
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  const resumeBytesBefore = serialWriteBytes(await kerfdesk.events()).length;
  await page.getByRole('button', { name: 'Resume' }).click();
  await expectRealtimeCommandThenStatusQuery(kerfdesk, resumeBytesBefore, 0x7e);
  await kerfdesk.emitSerialLine('<Run|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:1500,0>');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  await kerfdesk.setAutoAcknowledge(true);
  const abortWritesBefore = serialWrites(await kerfdesk.events()).length;
  await page.getByRole('button', { name: 'ABORT JOB', exact: true }).click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('\u0018');
  await expect(page.getByRole('button', { name: 'Set up & Frame', exact: true })).toBeVisible();
  await expect
    .poll(async () => serialWrites(await kerfdesk.events()).slice(abortWritesBefore))
    .toContain('M9\n');

  await kerfdesk.emitSerialLine('ALARM:3');
  // ALARM:3 is diagnostic text; update the fixture's polled state after Abort too.
  await kerfdesk.emitSerialLine('<Alarm|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('alert')).toContainText('Alarm 3');
  await kerfdesk.setAutoAcknowledge(false);
  await kerfdesk.setSerialStatusAfterCommand(
    '$H\n',
    '<Home|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>',
  );
  const homeWritesBeforeRecovery = exactSerialWriteCount(await kerfdesk.events(), '$H\n');
  const settleWritesBeforeRecovery = exactSerialWriteCount(await kerfdesk.events(), 'G4 P0.01\n');
  await page.getByRole('button', { name: 'Home ($H)' }).click();
  await expect
    .poll(async () => exactSerialWriteCount(await kerfdesk.events(), '$H\n'))
    .toBeGreaterThan(homeWritesBeforeRecovery);
  await kerfdesk.acknowledgeSerial(1);
  await expect
    .poll(async () => exactSerialWriteCount(await kerfdesk.events(), 'G4 P0.01\n'))
    .toBeGreaterThan(settleWritesBeforeRecovery);
  await kerfdesk.acknowledgeSerial(1);
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up & Frame', exact: true })).toBeEnabled();
});

test('shows controller-reported canvas progress without treating acknowledgements as motion', async ({
  page,
  kerfdesk,
}) => {
  const probe = page.getByTestId('canvas-motion-probe');
  await expect(probe).toHaveAttribute('aria-label', /Frame start ready; Job start ready/);
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  page.on('dialog', (dialog) => void dialog.accept());
  const writesBefore = serialWrites(await kerfdesk.events()).length;
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await expect(probe).toHaveAttribute('data-lifecycle', 'running');
  const beforeAck = Number(await probe.getAttribute('data-confirmed-route-mm'));

  const programWrites = serialWrites(await kerfdesk.events()).slice(writesBefore);
  const firstMove = /G0 X(-?\d+(?:\.\d+)?) Y(-?\d+(?:\.\d+)?)/.exec(programWrites);
  expect(firstMove).not.toBeNull();
  const acceptedThroughFirstMove =
    [...programWrites.slice(0, firstMove?.index ?? 0)].filter((character) => character === '\n')
      .length + 1;
  await kerfdesk.acknowledgeSerial(acceptedThroughFirstMove);
  await expect
    .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
    .toBe(beforeAck);

  const targetX = Number(firstMove?.[1] ?? 0);
  const targetY = Number(firstMove?.[2] ?? 0);
  await kerfdesk.emitSerialLine(
    `<Run|MPos:${(targetX / 2).toFixed(3)},${(targetY / 2).toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:1500,0>`,
  );
  await expect
    .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
    .toBeGreaterThan(beforeAck);

  await page.getByRole('button', { name: 'Pause' }).click();
  const atPause = Number(await probe.getAttribute('data-confirmed-route-mm'));
  await kerfdesk.emitSerialLine(
    `<Door:0|MPos:${targetX.toFixed(3)},${targetY.toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>`,
  );
  await expect(probe).toHaveAttribute('data-lifecycle', 'paused');
  expect(Number(await probe.getAttribute('data-confirmed-route-mm'))).toBe(atPause);

  const resume = page.getByRole('button', { name: 'Resume' });
  await expect(resume).toBeVisible();
  await resume.click();
  await kerfdesk.emitSerialLine(
    `<Run|MPos:${targetX.toFixed(3)},${targetY.toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:1500,0>`,
  );
  await expect
    .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
    .toBeGreaterThan(atPause);

  await page.getByRole('button', { name: 'ABORT JOB', exact: true }).click();
  await expect(probe).toHaveAttribute('data-lifecycle', 'stopped');
  expect(Number(await probe.getAttribute('data-confirmed-route-mm'))).toBeGreaterThanOrEqual(
    atPause,
  );
});

test('keeps the finished route and confirms it only after the stream settles Idle', async ({
  page,
  kerfdesk,
}) => {
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  page.on('dialog', (dialog) => void dialog.accept());
  const baselineLines = serialWriteLineCount(await kerfdesk.events());
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  const probe = page.getByTestId('canvas-motion-probe');
  await expect(probe).toHaveAttribute('data-lifecycle', 'running');
  await drainHeldSerialWrites(page, kerfdesk, baselineLines);
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(probe).toHaveAttribute('data-lifecycle', 'finished');
  await expect
    .poll(async () => Number(await probe.getAttribute('data-confirmed-route-mm')))
    .toBeGreaterThan(0);
});

test('offers a selected-area second pass after completion with the Machine panel collapsed', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Wait for the responsive panel replacement before selecting its controls.
  await expect(
    page.getByRole('region', { name: 'Workspace side panels', exact: true }),
  ).toHaveAttribute('data-layout', 'spacious');
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  const baselineLines = serialWriteLineCount(await kerfdesk.events());
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await page.getByRole('button', { name: 'Collapse Laser panel', exact: true }).click();
  const focusReturn = page.getByRole('button', { name: 'Open...', exact: true });
  await focusReturn.focus();
  await drainHeldSerialWrites(page, kerfdesk, baselineLines);
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  await expect(complete).toContainText('Would you like to darken selected areas?');
  await expect(page.getByLabel('Laser controls collapsed')).toBeVisible();
  await dismissNotifications(page);
  await complete.screenshot({ path: testInfo.outputPath('completed-job-second-pass-offer.png') });
  const beforeOpening = serialWrites(await kerfdesk.events());
  await complete.getByRole('button', { name: 'Darken selected areas…' }).click();
  const workbench = page.getByRole('dialog', { name: 'Paint a second pass', exact: true });
  await expect(
    workbench.getByRole('img', {
      name: 'Paint second-pass areas on the saved engraving',
    }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(serialWrites(await kerfdesk.events()).slice(beforeOpening.length)).not.toMatch(
    /G[0123]\s/,
  );
  await workbench.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(complete).toHaveCount(0);
  await expect(focusReturn).toBeFocused();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open...' })).toBeVisible();
  await expect(complete).toHaveCount(0);
});

test('preserves an interrupted laser checkpoint after a cable disconnect', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  page.on('dialog', (dialog) => void dialog.accept());
  const baselineLines = serialWriteLineCount(await kerfdesk.events());

  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect
    .poll(async () => serialWriteLineCount(await kerfdesk.events()))
    .toBeGreaterThan(baselineLines);
  await kerfdesk.acknowledgeSerial(1);
  await kerfdesk.disconnectSerial();

  const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
  await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toHaveCount(0);
  await recovery.getByText('Interrupted job saved', { exact: true }).click();
  await expect(recovery.locator('p').filter({ hasText: 'Recorded cause:' })).toContainText(
    /connection|disconnect|USB/i,
  );
  await expect(
    recovery.getByRole('button', { name: 'Review recovery', exact: true }),
  ).toBeVisible();
  await expect(
    recovery.getByTitle('Permanently discard only this isolated recovery capsule.'),
  ).toBeVisible();

  // Make the live canvas differ from the archived run before opening its review.
  await selectAll(page);
  await expect(page.getByRole('spinbutton', { name: 'Selection X position' })).toHaveValue('10');
  await fillAndCommit(page, 'Selection X position', '47');
  await (await toolbarCommand(page, 'Save As...')).click();
  const currentProject = await savedProject(kerfdesk);
  const savedBeforeReview = fileSavedCount(await kerfdesk.events());
  const writesBeforeReview = serialWriteBytes(await kerfdesk.events());

  await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review interrupted laser job' });
  await expect(review).toContainText('Exact job artifact saved');
  await expect(review).toContainText(
    'Reviewing or closing this saved job does not change the current canvas',
  );
  const restartCanvas = review.getByRole('img', { name: /^Laser recovery canvas:/ });
  await expect(restartCanvas).toBeVisible();
  await selectRecoveryMovement(restartCanvas);
  const selectedLine = await review
    .getByTestId('selected-recovery-movement')
    .getAttribute('data-raw-line');
  if (selectedLine === null) throw new Error('Expected the selected original G-code line.');
  await expect(review.getByRole('spinbutton', { name: 'Restart from G-code line' })).toHaveValue(
    selectedLine,
  );
  const beforeZoom = await restartCanvas.getAttribute('viewBox');
  if (beforeZoom === null) throw new Error('Expected the saved route viewport.');
  await review.getByRole('button', { name: 'Zoom in recovery canvas' }).click();
  await expect(restartCanvas).not.toHaveAttribute('viewBox', beforeZoom);
  await review.screenshot({ path: testInfo.outputPath('saved-laser-restart-preview.png') });
  await review.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Selection X position' })).toHaveValue('47');

  await (await toolbarCommand(page, 'Save As...')).click();
  await expect
    .poll(async () => fileSavedCount(await kerfdesk.events()))
    .toBeGreaterThan(savedBeforeReview);
  expect(await savedProject(kerfdesk)).toEqual(currentProject);
  expect(serialWriteBytes(await kerfdesk.events())).toEqual(writesBeforeReview);

  // Resume the sealed job after reconnect, without framing the edited canvas.
  await kerfdesk.setAutoAcknowledge(true);
  await connectAndHome(page, kerfdesk);
  await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
  await selectRecoveryMovement(review.getByRole('img', { name: /^Laser recovery canvas:/ }), true);
  await kerfdesk.setAutoAcknowledge(false);
  const queriesBeforeResume = serialWriteBytes(await kerfdesk.events()).filter(
    (byte) => byte === 0x3f,
  ).length;
  await review.getByRole('button', { name: 'Start supervised recovery', exact: true }).click();
  await expect
    .poll(
      async () => serialWriteBytes(await kerfdesk.events()).filter((byte) => byte === 0x3f).length,
    )
    .toBeGreaterThan(queriesBeforeResume);
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(review).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await kerfdesk.acknowledgeSerial(1);
  await kerfdesk.disconnectSerial();
  await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
  if (!(await recovery.getByRole('button', { name: 'Review recovery', exact: true }).isVisible()))
    await recovery.getByText('Interrupted job saved', { exact: true }).click();
  await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
  await expect(review).toContainText('Exact job artifact saved');
  await expect(review.getByRole('img', { name: /^Laser recovery canvas:/ })).toBeVisible();
  await review.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Selection X position' })).toHaveValue('47');
});

test('prepares a large image restart preview and starts only the selected remainder', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await selectAll(page);
  await runMenuCommand(page, 'Edit', 'Delete');
  await kerfdesk.setOpenFiles([
    { name: 'restart-image.png', kind: 'png-fixture', width: 600, height: 600 },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByRole('spinbutton', { name: 'Selection width' })).toHaveValue('60');
  await page.getByRole('spinbutton', { name: 'Selection width' }).click();
  await fillAndCommit(page, 'Selection width', '20');
  await page.getByRole('spinbutton', { name: 'Selection height' }).click();
  await fillAndCommit(page, 'Selection height', '20');
  await connectAndHome(page, kerfdesk);
  await dismissNotifications(page);
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    alerts.push(dialog.message());
    void dialog.accept();
  });
  await page.getByText('History & recovery', { exact: true }).click();
  await page.getByText('Start from line…', { exact: true }).click();
  const beforePreview = serialWrites(await kerfdesk.events());
  await page.getByRole('button', { name: 'Choose restart point…', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Choose laser restart point' });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  expect(workerUrls.some((url) => url.includes('output-preparation-worker'))).toBe(true);
  expect(serialWrites(await kerfdesk.events()).slice(beforePreview.length)).not.toMatch(
    /G[0123]\s/,
  );
  await selectRecoveryMovement(preview.getByRole('img', { name: /^Laser recovery canvas:/ }), true);
  expect(Number(await preview.getByLabel('Restart from G-code line').inputValue())).toBeGreaterThan(
    50,
  );
  await preview.screenshot({ path: testInfo.outputPath('image-restart-preview.png') });
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(serialWrites(await kerfdesk.events())).not.toContain('resume preamble');

  await page.getByRole('button', { name: 'Choose restart point…', exact: true }).click();
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await selectRecoveryMovement(preview.getByRole('img', { name: /^Laser recovery canvas:/ }), true);
  await kerfdesk.setAutoAcknowledge(false);
  const queriesBefore = serialWriteBytes(await kerfdesk.events()).filter(
    (byte) => byte === 0x3f,
  ).length;
  await preview.getByRole('button', { name: 'Start selected remainder', exact: true }).click();
  await expect
    .poll(
      async () => serialWriteBytes(await kerfdesk.events()).filter((byte) => byte === 0x3f).length,
    )
    .toBeGreaterThan(queriesBefore);
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(preview).not.toBeVisible();
  expect(
    alerts.some((message) => message.includes('Background recovery compilation is not available')),
  ).toBe(false);
  expect(alerts.some((message) => message.includes('Review resume from requested line'))).toBe(
    true,
  );
  await kerfdesk.disconnectSerial();
});

async function selectRecoveryMovement(
  canvas: import('@playwright/test').Locator,
  halfway = false,
): Promise<void> {
  const path = await canvas.locator('path').first().getAttribute('d');
  const segments = Array.from((path ?? '').matchAll(/M([^,]+),([^L]+)L([^,]+),([^M]+)/g));
  const segment = segments[halfway ? Math.floor(segments.length / 2) : 0];
  if (segment === undefined) throw new Error('Expected a displayed recovery movement.');
  const [left = NaN, top = NaN, width = NaN, height = NaN] = (
    (await canvas.getAttribute('viewBox')) ?? ''
  )
    .split(' ')
    .map(Number);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new Error('Expected a finite recovery viewport.');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Expected visible recovery canvas.');
  const x = (Number(segment[1]) + Number(segment[3])) / 2;
  const y = (Number(segment[2]) + Number(segment[4])) / 2;
  await canvas.click({
    position: {
      x: ((x - left) / width) * box.width,
      y: ((y - top) / height) * box.height,
    },
  });
}

test('paints, erases, adjusts and recovers a second pass from a completed image', async ({
  page,
  kerfdesk,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => {
    errors.push(dialog.message());
    void dialog.accept();
  });
  await selectAll(page);
  await runMenuCommand(page, 'Edit', 'Delete');
  await kerfdesk.setOpenFiles([
    { name: 'painted-image.png', kind: 'png-fixture', width: 120, height: 120 },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByRole('spinbutton', { name: 'Selection width' })).toHaveValue('12');
  await page.getByRole('spinbutton', { name: 'Selection width' }).click();
  await fillAndCommit(page, 'Selection width', '20');
  await page.getByRole('spinbutton', { name: 'Selection height' }).click();
  await fillAndCommit(page, 'Selection height', '20');
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await expect(page.getByTestId('canvas-motion-probe')).toHaveAttribute(
    'data-lifecycle',
    'finished',
    { timeout: 30_000 },
  );
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  await expect(complete).toContainText('Would you like to darken selected areas?');
  await complete.getByRole('button', { name: 'Done', exact: true }).click();
  await dismissNotifications(page);
  const paintButton = page.getByRole('button', { name: 'Paint a second pass…', exact: true });
  await expect(paintButton).toBeEnabled();
  await selectAll(page);
  await fillAndCommit(page, 'Selection X position', '47');
  const beforePainting = serialWrites(await kerfdesk.events());
  await paintButton.click();
  const workbench = page.getByRole('dialog', { name: 'Paint a second pass', exact: true });
  const canvas = workbench.getByRole('img', {
    name: 'Paint second-pass areas on the saved engraving',
  });
  await expect(canvas).toBeVisible();
  await workbench.getByLabel('Brush diameter (mm)').fill('8');
  await workbench.getByLabel('Paint power (% of original)').fill('150');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Expected the painted engraving canvas.');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(
    workbench.getByRole('button', { name: 'Paint 1 · 150%', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      canvas
        .locator('canvas')
        .nth(1)
        .evaluate(
          (node: HTMLCanvasElement) =>
            node
              .getContext('2d')
              ?.getImageData(Math.floor(node.width / 2), Math.floor(node.height / 2), 1, 1)
              .data[3] ?? 0,
        ),
    )
    .toBeGreaterThan(0);
  await workbench.getByRole('button', { name: 'Eraser', exact: true }).click();
  await workbench.getByLabel('Brush diameter (mm)').fill('2');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(workbench.getByRole('button', { name: 'Erase 2', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      canvas
        .locator('canvas')
        .nth(1)
        .evaluate(
          (node: HTMLCanvasElement) =>
            node
              .getContext('2d')
              ?.getImageData(Math.floor(node.width / 2), Math.floor(node.height / 2), 1, 1)
              .data[3] ?? 255,
        ),
    )
    .toBe(0);
  await workbench.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(workbench.getByRole('button', { name: 'Erase 2', exact: true })).not.toBeVisible();
  await workbench.getByRole('button', { name: 'Redo', exact: true }).click();
  await workbench.getByRole('button', { name: 'Preview second pass', exact: true }).click();
  await expect(
    workbench.getByRole('button', { name: 'Frame second pass', exact: true }),
  ).toBeEnabled();
  expect(serialWrites(await kerfdesk.events()).slice(beforePainting.length)).not.toMatch(
    /G[0123]\s/,
  );
  await expect(page.getByText(/Job recovery tracking hit an unexpected error/)).toHaveCount(0);
  await workbench.screenshot({ path: testInfo.outputPath('painted-image-second-pass.png') });
  await workbench.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Selection X position' })).toHaveValue('47');
  await paintButton.click();
  await expect(
    workbench.getByRole('button', { name: 'Paint 1 · 150%', exact: true }),
  ).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Erase 2', exact: true })).toBeVisible();
  await workbench.getByRole('button', { name: 'Preview second pass', exact: true }).click();
  await expect(
    workbench.getByRole('button', { name: 'Frame second pass', exact: true }),
  ).toBeEnabled();
  await workbench.getByRole('button', { name: 'Frame second pass', exact: true }).click();
  await expect(
    workbench.getByRole('button', { name: 'Start second pass', exact: true }),
  ).toBeEnabled();
  await workbench.getByRole('button', { name: 'Paint 1 · 150%', exact: true }).click();
  await workbench.getByLabel('Selected stroke power (% of original)').fill('125');
  await expect(
    workbench.getByRole('button', { name: 'Start second pass', exact: true }),
  ).toBeDisabled();
  await workbench.getByRole('button', { name: 'Preview second pass', exact: true }).click();
  await expect(
    workbench.getByRole('button', { name: 'Frame second pass', exact: true }),
  ).toBeEnabled();
  await workbench.getByRole('button', { name: 'Frame second pass', exact: true }).click();
  await expect(
    workbench.getByRole('button', { name: 'Start second pass', exact: true }),
  ).toBeEnabled();
  await kerfdesk.setAutoAcknowledge(false);
  await workbench.getByRole('button', { name: 'Start second pass', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review painted second pass' });
  await expect(review).toBeVisible();
  await expect(review.getByRole('spinbutton')).toHaveCount(0);
  await review.getByRole('button', { name: 'Start second pass', exact: true }).click();
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await kerfdesk.acknowledgeSerial(1);
  await kerfdesk.disconnectSerial();
  const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
  await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
  await recovery.getByText('Interrupted job saved', { exact: true }).click();
  await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review interrupted laser job' })).toContainText(
    'Exact job artifact saved',
  );
  await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('uses jog speed for XY buttons and return to work zero without hijacking canvas arrows', async ({
  page,
  kerfdesk,
}) => {
  await connectAndHome(page, kerfdesk);
  await page.getByRole('combobox', { name: 'Jog speed' }).selectOption('1000');

  await page.getByRole('button', { name: 'Jog +X +Y 10 mm' }).click();
  await expect
    .poll(async () => serialWrites(await kerfdesk.events()))
    .toContain('$J=G91 G21 X10.000 Y10.000 F1000');
  await kerfdesk.emitSerialLine('<Idle|MPos:10.000,10.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');

  const jogWritesBeforeArrow = jogWriteCount(await kerfdesk.events());
  const selectionY = page.getByRole('spinbutton', { name: 'Selection Y position' });
  const selectionYBeforeArrow = Number(await selectionY.inputValue());
  await page.keyboard.press('ArrowUp');
  await expect(selectionY).toHaveValue(String(selectionYBeforeArrow - 1));

  await page.getByRole('button', { name: 'Set origin here' }).click();
  await expect
    .poll(async () => exactSerialWriteCount(await kerfdesk.events(), 'G54 G92 X0 Y0\n'))
    .toBe(1);
  expect(jogWriteCount(await kerfdesk.events())).toBe(jogWritesBeforeArrow);
  await kerfdesk.emitSerialLine('<Idle|MPos:50.000,30.000,0.000|WCO:10.000,10.000,0.000|FS:0,0>');

  const goToWorkZero = page.getByRole('button', { name: 'Go to work zero' });
  await expect(goToWorkZero).toBeEnabled();
  await dismissNotifications(page);
  await goToWorkZero.click();
  await expect
    .poll(async () =>
      exactSerialWriteCount(await kerfdesk.events(), '$J=G91 G21 X-40.000 Y-20.000 F1000\n'),
    )
    .toBe(1);
});

async function selectAll(page: Page): Promise<void> {
  await runMenuCommand(page, 'Edit', 'Select All');
}

async function frameCurrentJob(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  const writesBeforeFrame = serialWrites(await kerfdesk.events()).length;
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect
    .poll(async () => serialWrites(await kerfdesk.events()).slice(writesBeforeFrame))
    .toContain('$J=G90 G21');
  await expect(page.getByRole('button', { name: 'Start framed job', exact: true })).toBeEnabled();
}

// ADR-224: every Start now opens the Job Review dialog; its single Start
// button is the acknowledgement that absorbed the old native confirms.
async function confirmJobReview(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  const statusQueriesBefore = serialWriteBytes(await kerfdesk.events()).filter(
    (byte) => byte === 0x3f,
  ).length;
  await page
    .getByRole('dialog', { name: 'Review job before starting' })
    .getByRole('button', { name: 'Start job' })
    .click();
  await expect
    .poll(
      async () => serialWriteBytes(await kerfdesk.events()).filter((byte) => byte === 0x3f).length,
    )
    .toBeGreaterThan(statusQueriesBefore);
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
}

async function choosePreparedGcodeDestination(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Save G-code' });
  await expect(dialog).toContainText('The complete export is ready.');
  await dialog.getByRole('button', { name: 'Choose destination…' }).click();
  await acceptGcodeFilename(page);
}

async function dismissNotifications(page: Page): Promise<void> {
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while ((await notifications.count()) > 0) {
    await notifications.first().click();
  }
}

async function fillAndCommit(page: Page, name: string, value: string): Promise<void> {
  const input = page.getByRole('spinbutton', { name });
  await input.fill(value);
  await input.press('Tab');
  await expect(input).toHaveValue(value);
}

async function acceptGcodeFilename(page: Page): Promise<void> {
  const panel = page.getByRole('dialog', { name: 'Choose G-code filename' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
}

async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  const applicationMenu = page.getByRole('menubar', { name: 'Application menu' });
  await applicationMenu.getByRole('menuitem', { name: family, exact: true }).click();
  await applicationMenu.getByRole('menuitem').filter({ hasText: command }).click();
}

async function enableLab(page: Page, label: string): Promise<void> {
  await runMenuCommand(page, 'Tools', 'Labs...');
  await page.getByText(label, { exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
}

async function connectAndHome(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await expandMachineUtilities(page);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('G4 P0.01');
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
}

function serialWrites(events: readonly Readonly<Record<string, unknown>>[]): string {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .join('');
}

function serialWriteBytes(events: readonly Readonly<Record<string, unknown>>[]): number[] {
  return events.flatMap((event) => {
    if (event['kind'] !== 'serial-write') return [];
    const bytes = event['bytes'];
    if (!Array.isArray(bytes)) return [];
    return bytes.filter((value): value is number => typeof value === 'number');
  });
}

async function expectRealtimeCommandThenStatusQuery(
  kerfdesk: KerfDeskFixture,
  baselineBytes: number,
  command: number,
): Promise<void> {
  await expect
    .poll(async () => {
      const bytes = serialWriteBytes(await kerfdesk.events()).slice(baselineBytes);
      const commandIndex = bytes.indexOf(command);
      // Polling can interleave writes; the command and query need not be adjacent.
      return commandIndex >= 0 && bytes.slice(commandIndex + 1).includes(0x3f);
    })
    .toBe(true);
}

function serialWriteLineCount(events: readonly Readonly<Record<string, unknown>>[]): number {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .reduce((count, text) => count + [...text].filter((character) => character === '\n').length, 0);
}

function jogWriteCount(events: readonly Readonly<Record<string, unknown>>[]): number {
  return events.filter(
    (event) => event['kind'] === 'serial-write' && String(event['text']).startsWith('$J='),
  ).length;
}

function absoluteXyJogWrites(
  events: readonly Readonly<Record<string, unknown>>[],
  baselineCharacters: number,
): string[] {
  return (
    serialWrites(events)
      .slice(baselineCharacters)
      .match(/\$J=G90 G21 X-?\d+(?:\.\d+)? Y-?\d+(?:\.\d+)? F\d+\n/g) ?? []
  );
}

async function drainHeldSerialWrites(
  page: Page,
  kerfdesk: KerfDeskFixture,
  baselineLines: number,
): Promise<void> {
  let acknowledged = 0;
  let stablePasses = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const written = serialWriteLineCount(await kerfdesk.events()) - baselineLines;
    const pending = written - acknowledged;
    if (pending > 0) {
      await kerfdesk.acknowledgeSerial(pending);
      acknowledged += pending;
      stablePasses = 0;
    } else {
      stablePasses += 1;
      if (stablePasses >= 3) return;
    }
    await page.waitForTimeout(25);
  }
  throw new Error('Held serial writes did not drain.');
}

async function drainHeldFrameWrites(
  page: Page,
  kerfdesk: KerfDeskFixture,
  baselineLines: number,
  baselineCharacters: number,
): Promise<void> {
  let acknowledged = 0;
  let stablePasses = 0;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const events = await kerfdesk.events();
    const written = serialWriteLineCount(events) - baselineLines;
    const pending = written - acknowledged;
    if (pending > 0) {
      await kerfdesk.acknowledgeSerial(pending);
      acknowledged += pending;
      stablePasses = 0;
    } else if (serialWrites(events).slice(baselineCharacters).includes('G4 P0.01\n')) {
      stablePasses += 1;
      if (stablePasses >= 3) return;
    }
    await page.waitForTimeout(25);
  }
  throw new Error('Held Frame writes did not reach the controller-settle command.');
}

function exactSerialWriteCount(
  events: readonly Readonly<Record<string, unknown>>[],
  text: string,
): number {
  return events.filter(
    (event) => event['kind'] === 'serial-write' && String(event['text']) === text,
  ).length;
}

async function savedProject(kerfdesk: {
  savedFiles: () => Promise<Readonly<Record<string, string>>>;
}): Promise<SavedProject> {
  return JSON.parse(await savedText(kerfdesk, '.lf2')) as SavedProject;
}

async function savedText(
  kerfdesk: { savedFiles: () => Promise<Readonly<Record<string, string>>> },
  extension: string,
): Promise<string> {
  await expect
    .poll(async () =>
      Object.keys(await kerfdesk.savedFiles()).some((name) => name.endsWith(extension)),
    )
    .toBe(true);
  const files = await kerfdesk.savedFiles();
  const entry = Object.entries(files).find(([name]) => name.endsWith(extension));
  if (entry === undefined) throw new Error(`Saved ${extension} file missing`);
  return entry[1];
}

function fileSavedCount(events: readonly Readonly<Record<string, unknown>>[]): number {
  return events.filter((event) => event['kind'] === 'file-saved').length;
}

interface SavedProject {
  readonly device: {
    readonly profileId?: string;
    readonly controllerKind?: string;
    readonly bedWidth?: number;
    readonly bedHeight?: number;
    readonly framingFeedMmPerMin?: number;
    readonly estimateCutTimeScale?: number;
    readonly estimateTravelTimeScale?: number;
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
    readonly recordIndex?: number;
    readonly serialValue?: number;
    readonly sequence?: {
      readonly recordStartIndex: number;
      readonly recordEndIndex: number;
      readonly serialStartValue: number;
      readonly serialEndValue?: number;
      readonly advanceBy: number;
    };
    readonly csv?: {
      readonly sourceName: string;
      readonly headers: readonly string[];
      readonly records: readonly (readonly string[])[];
    };
  };
  readonly scene: { readonly objects: readonly Record<string, unknown>[] };
}

function outlineNestProjectFixture(): string {
  const object = (id: string, x: number, points: readonly (readonly [number, number])[]) => ({
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: {
      x,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      mirrorX: false,
      mirrorY: false,
    },
    paths: [
      {
        color: '#000000',
        polylines: [
          { closed: true, points: points.map(([pointX, pointY]) => ({ x: pointX, y: pointY })) },
        ],
      },
    ],
  });
  return JSON.stringify({
    schemaVersion: 1,
    device: {
      name: 'Outline Nest Fixture',
      bedWidth: 40,
      bedHeight: 40,
      maxFeed: 6_000,
      maxPowerS: 1_000,
      capabilities: ['grbl'],
      origin: 'front-left',
      homing: { enabled: true, direction: 'front-left' },
      autofocusCommand: '',
    },
    workspace: { width: 40, height: 40, units: 'mm' },
    scene: {
      objects: [
        object('upper', 0, [
          [0, 0],
          [40, 0],
          [0, 40],
        ]),
        object('lower', 40, [
          [40, 40],
          [40, 0],
          [0, 40],
        ]),
      ],
      layers: [
        {
          id: '#000000',
          color: '#000000',
          mode: 'line',
          minPower: 0,
          power: 30,
          speed: 1_500,
          passes: 1,
          visible: true,
          output: true,
          airAssist: false,
          kerfOffsetMm: 0,
          tabsEnabled: false,
          tabSizeMm: 0.5,
          tabsPerShape: 4,
          tabSkipInnerShapes: true,
          hatchAngleDeg: 0,
          hatchSpacingMm: 0.1,
          fillOverscanMm: 5,
          fillStyle: 'scanline',
          fillBidirectional: true,
          fillCrossHatch: false,
          ditherAlgorithm: 'floyd-steinberg',
          linesPerMm: 10,
          imageBidirectional: true,
          negativeImage: false,
          passThrough: false,
          dotWidthCorrectionMm: 0,
          subLayers: [],
        },
      ],
      groups: [],
    },
  });
}
