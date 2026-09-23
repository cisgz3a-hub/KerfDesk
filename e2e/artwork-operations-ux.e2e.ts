import {
  expect,
  test,
  type KerfDeskFixture,
  type Locator,
  type Page,
} from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

test('laser line and fill edits survive artwork navigation, output changes and save/reopen', async ({
  page,
  kerfdesk,
}) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  const panel = await openBasicProject(page);
  await setNumber(panel, /^Power for/, '37');
  await setNumber(panel, /^Speed for/, '1800');
  await setNumber(panel, /^Passes for/, '2');
  await openSection(panel, /^Line options/);
  await setNumber(panel, /^Contour entry for/, '3');

  const editorTabs = panel.getByRole('tablist', { name: 'Edit artwork or operation' });
  await editorTabs.getByRole('tab', { name: 'Operation', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(editorTabs.getByRole('tab', { name: 'Artwork', exact: true })).toBeFocused();
  await expect(panel.getByRole('heading', { name: 'Artwork adjustments' })).toBeVisible();
  await setNumber(panel, /^Power scale for/, '80');
  await editorTabs.getByRole('tab', { name: 'Artwork', exact: true }).press('Home');
  await expect(editorTabs.getByRole('tab', { name: 'Operation', exact: true })).toBeFocused();
  await expect(panel.getByRole('spinbutton', { name: /^Power for/ })).toHaveValue('37');

  await panel.getByRole('combobox', { name: /^Mode for/ }).selectOption('fill');
  await openSection(panel, /^Fill options/);
  await setNumber(panel, /^Hatch angle for/, '30');
  await setNumber(panel, /^Hatch spacing for/, '0.2');
  await setNumber(panel, /^Fill overscan for/, '4');
  await panel.getByRole('checkbox', { name: /^Bidirectional fill for/ }).uncheck();
  await panel.getByRole('checkbox', { name: /^Output / }).uncheck();
  await expect(panel.getByRole('status')).toContainText('excluded from output');
  await panel.getByRole('checkbox', { name: /^Show / }).uncheck();
  await expect(panel.getByRole('checkbox', { name: /^Output / })).not.toBeChecked();
  await panel.getByRole('checkbox', { name: /^Show / }).check();

  await choosePanelView(panel, 'Run order');
  const run = panel.getByRole('article', { name: /^Run 1:/ });
  await expect(run).toContainText('Output off');
  await run.getByRole('button', { name: 'Edit settings', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: /^Mode for/ })).toHaveValue('fill');
  await panel.getByRole('checkbox', { name: /^Output / }).check();

  const { text, project } = await saveProject(page, kerfdesk);
  expect(project.scene.layers[0]).toMatchObject({
    mode: 'fill',
    power: 37,
    speed: 1800,
    passes: 2,
    output: true,
    visible: true,
    hatchAngleDeg: 30,
    hatchSpacingMm: 0.2,
    fillOverscanMm: 4,
    fillBidirectional: false,
  });
  expect(project.scene.objects[0]).toMatchObject({ powerScale: 80 });
  await kerfdesk.setOpenFiles([{ name: 'artwork-roundtrip.lf2', text }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/artwork-roundtrip\.lf2/);
  await expect(panel.getByRole('combobox', { name: /^Mode for/ })).toHaveValue('fill');
  await expect(panel.getByRole('spinbutton', { name: /^Power for/ })).toHaveValue('37');
  await openSection(panel, /^Fill options/);
  await expect(panel.getByRole('spinbutton', { name: /^Hatch spacing for/ })).toHaveValue('0.2');
  await expect(panel.getByRole('checkbox', { name: /^Bidirectional fill for/ })).not.toBeChecked();
  await expectNoSerial(kerfdesk);
});

test('CNC refinements remain reachable, editable and saved behind their disclosures', async ({
  page,
  kerfdesk,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  const panel = await openBasicProject(page);
  await panel.getByRole('button', { name: 'CNC', exact: true }).click();
  await panel.getByRole('combobox', { name: /^Cut type for/ }).selectOption('profile-outside');
  await setNumber(panel, /^Cut depth for/, '2.5');
  await setNumber(panel, /^Feed for/, '1200');
  await expect(panel.getByRole('button', { name: /^Machine maximum:/ })).toBeVisible();
  await expect(panel.locator('input[aria-label^="Holding tabs for"]')).toBeHidden();
  await openSection(panel, /^Holding tabs/);
  await panel.getByRole('checkbox', { name: /^Holding tabs for/ }).check();
  await setNumber(panel, /^Tabs per shape for/, '5');
  await openSection(panel, /^Wall finish/);
  await setNumber(panel, /^Finish allowance for/, '0.2');
  await openSection(panel, /^Entry & travel/);
  await setNumber(panel, /^Ramp entry angle for/, '2');
  await openSection(panel, /^Saved feeds/);
  await panel.getByRole('textbox', { name: /^New feeds preset name for/ }).fill('Birch test feed');
  await panel.getByRole('button', { name: /^Save feeds preset for/ }).click();
  await expect(panel.getByRole('combobox', { name: /^Apply feeds preset for/ })).toBeEnabled();

  await panel.getByRole('combobox', { name: /^Cut type for/ }).selectOption('pocket');
  await openSection(panel, /^Clearing strategy/);
  await panel
    .getByRole('combobox', { name: 'Pocket fill method', exact: true })
    .selectOption('raster-x');
  await setNumber(panel, /^Stepover for/, '35');
  await choosePanelView(panel, 'Run order');
  const run = panel.getByRole('article', { name: /^Run 1:/ });
  await expect(run).toContainText('Actual CNC step');
  await run.getByRole('button', { name: 'Edit settings', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: /^Cut type for/ })).toHaveValue('pocket');
  const { project } = await saveProject(page, kerfdesk);
  expect(project.scene.layers[0]?.cnc).toMatchObject({
    cutType: 'pocket',
    depthMm: 2.5,
    feedMmPerMin: 1200,
    tabsEnabled: true,
    tabsPerShape: 5,
    finishAllowanceMm: 0.2,
    rampEntryDeg: 2,
    pocketStrategy: 'raster-x',
    stepoverPercent: 35,
  });
  await expectNoSerial(kerfdesk);
});

test('direct CNC material and bit choices persist without changing machine defaults', async ({
  page,
  kerfdesk,
}) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  const panel = await openBasicProject(page);
  await panel.getByRole('button', { name: 'CNC', exact: true }).click();
  await panel.getByRole('combobox', { name: /^Cut type for/ }).selectOption('pocket');
  const baseline = await saveProject(page, kerfdesk);
  expect(baseline.project.machine).toMatchObject({ kind: 'cnc' });
  const material = panel.getByRole('combobox', { name: /^Material for/ });
  const bit = panel.getByRole('combobox', { name: /^Bit for/ });
  const rougher = panel.getByRole('combobox', { name: /^Pocket roughing bit for/ });
  await material.selectOption('hardwood-birch');
  await bit.selectOption('em-1588');
  await rougher.selectOption('em-6350');
  await expect(page.getByRole('dialog', { name: 'CNC Machine Setup' })).toHaveCount(0);

  const assigned = await saveProject(page, kerfdesk);
  expect(assigned.project.scene.layers[0]?.cnc).toMatchObject({
    cutType: 'pocket',
    materialKey: 'hardwood-birch',
    toolId: 'em-1588',
    pocketRoughToolId: 'em-6350',
    feedSource: { kind: 'material-recipe', materialKey: 'hardwood-birch' },
  });
  expect(assigned.project.machine).toEqual(baseline.project.machine);
  const recipe = recipeNumbers(assigned.project.scene.layers[0]?.cnc);
  expect(recipe).not.toEqual(recipeNumbers(baseline.project.scene.layers[0]?.cnc));
  for (const value of Object.values(recipe)) expect(value).toBeGreaterThan(0);
  await kerfdesk.setOpenFiles([{ name: 'direct-cnc-roundtrip.lf2', text: assigned.text }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/direct-cnc-roundtrip\.lf2/, { timeout: 30_000 });
  await expect(material).toHaveValue('hardwood-birch');
  await expect(bit).toHaveValue('em-1588');
  await expect(rougher).toHaveValue('em-6350');

  await material.selectOption('');
  await bit.selectOption('');
  for (const [name, value] of [
    [/^Feed for/, recipe.feedMmPerMin],
    [/^Plunge for/, recipe.plungeMmPerMin],
    [/^Artwork spindle speed for/, recipe.spindleRpm],
    [/^Depth per pass for/, recipe.depthPerPassMm],
  ] as const) {
    await expect(panel.getByRole('spinbutton', { name })).toHaveValue(String(value));
  }
  await expect(rougher).toHaveValue('em-6350');
  const manual = await saveProject(page, kerfdesk);
  const manualSettings = manual.project.scene.layers[0]?.cnc;
  expect(manualSettings).toMatchObject({ ...recipe, pocketRoughToolId: 'em-6350' });
  for (const key of ['materialKey', 'feedSource', 'toolId']) {
    expect(manualSettings).not.toHaveProperty(key);
  }
  expect(manual.project.machine).toEqual(baseline.project.machine);
  await kerfdesk.setOpenFiles([{ name: 'manual-cnc-roundtrip.lf2', text: manual.text }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/manual-cnc-roundtrip\.lf2/, { timeout: 30_000 });
  await expect(material).toHaveValue('');
  await expect(bit).toHaveValue('');
  await expect(rougher).toHaveValue('em-6350');
  await expectNoSerial(kerfdesk);
});

for (const viewport of [
  { width: 1024, height: 600 },
  { width: 1536, height: 864 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`artwork controls fit ${viewport.width}x${viewport.height} in ${theme} theme`, async ({
      page,
      kerfdesk,
    }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem('kerfdesk.theme.v1', value), theme);
      const panel = await openBasicProject(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await assertControlBounds(page, panel);
      await panel.getByRole('combobox', { name: /^Mode for/ }).selectOption('fill');
      await openSection(panel, /^Fill options/);
      await assertControlBounds(page, panel);
      await panel.getByRole('button', { name: 'Advanced cut settings', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /^Cut settings for/ });
      await expect(dialog).toBeVisible();
      await assertControlBounds(page, dialog);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

      await panel
        .getByRole('tablist', { name: 'Edit artwork or operation' })
        .getByRole('tab', { name: 'Artwork', exact: true })
        .click();
      await assertControlBounds(page, panel);
      await panel
        .getByRole('tablist', { name: 'Edit artwork or operation' })
        .getByRole('tab', { name: 'Operation', exact: true })
        .click();
      await choosePanelView(panel, 'Run order');
      await assertControlBounds(page, panel);
      await panel.getByRole('button', { name: 'Edit settings', exact: true }).click();
      await panel.getByRole('button', { name: 'CNC', exact: true }).click();
      await panel.getByRole('combobox', { name: /^Cut type for/ }).selectOption('profile-outside');
      for (const title of [
        /^Holding tabs/,
        /^Wall finish/,
        /^Entry & travel/,
        /^Saved feeds/,
        /^Stock & machine reference/,
      ]) {
        await openSection(panel, title);
      }
      await panel.getByRole('checkbox', { name: /^Holding tabs for/ }).check();
      await assertControlBounds(page, panel);
      await panel.getByRole('combobox', { name: /^Cut type for/ }).selectOption('pocket');
      await openSection(panel, /^Clearing strategy/);
      await assertControlBounds(page, panel);
      await expectNoSerial(kerfdesk);
    });
  }
}

async function openBasicProject(page: Page): Promise<Locator> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  // Project Open parses in a worker; a cold Vite worker can exceed the default
  // assertion deadline before the settings UI is ready for interaction.
  await expect(page).toHaveTitle(/project-basic\.lf2/, { timeout: 30_000 });
  const sideTab = page
    .getByRole('tablist', { name: 'Side panel', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true });
  if (await sideTab.isVisible()) await sideTab.click();
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await expect(panel.getByRole('combobox', { name: /^Mode for/ })).toBeVisible();
  return panel;
}

async function setNumber(scope: Locator, name: RegExp, value: string): Promise<void> {
  const input = scope.getByRole('spinbutton', { name });
  await input.fill(value);
  await input.press('Tab');
  await expect(input).toHaveValue(value);
}

async function openSection(scope: Locator, title: RegExp): Promise<void> {
  const summary = scope.locator('summary').filter({ hasText: title });
  const details = summary.locator('..');
  if ((await details.getAttribute('open')) === null) await summary.click();
  await expect(details).toHaveAttribute('open', '');
}

async function choosePanelView(panel: Locator, name: string): Promise<void> {
  await panel
    .getByRole('tablist', { name: 'Artwork panel view', exact: true })
    .getByRole('tab', { name, exact: true })
    .click();
}

async function saveProject(
  page: Page,
  fixture: KerfDeskFixture,
): Promise<{ text: string; project: SavedProject }> {
  const previousCount = (await fixture.events()).filter(
    (event) => event.kind === 'file-saved',
  ).length;
  await (await toolbarCommand(page, 'Save As...')).click();
  await expect
    .poll(
      async () => (await fixture.events()).filter((event) => event.kind === 'file-saved').length,
    )
    .toBeGreaterThan(previousCount);
  const name = (await fixture.events()).filter((event) => event.kind === 'file-saved').at(-1)?.[
    'name'
  ];
  const text = typeof name === 'string' ? (await fixture.savedFiles())[name] : undefined;
  if (text === undefined) throw new Error('Project was not saved');
  return { text, project: JSON.parse(text) as SavedProject };
}

async function assertControlBounds(page: Page, scope: Locator): Promise<void> {
  const outer = await scope.boundingBox();
  if (outer === null) throw new Error('Settings surface is not visible');
  const overflow = await scope
    .locator('button:visible, input:visible, select:visible, summary:visible')
    .evaluateAll(
      (elements, bounds) =>
        elements.flatMap((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1) return [];
          return [
            {
              label: element.getAttribute('aria-label') ?? element.textContent?.trim(),
              left: rect.left,
              right: rect.right,
            },
          ];
        }),
      { left: outer.x, right: outer.x + outer.width },
    );
  expect(overflow, 'Controls should stay inside their settings surface').toEqual([]);
  const contentOverflow = await scope
    .locator(
      '.lf-artwork-view-content, .lf-cnc-settings-card, .lf-laser-essentials, .lf-laser-process, .lf-run-order-card',
    )
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.getClientRects().length > 0 && element.scrollWidth > element.clientWidth + 1,
        )
        .map((element) => ({
          name: element.className,
          client: element.clientWidth,
          scroll: element.scrollWidth,
        })),
    );
  expect(contentOverflow, 'Settings content should not need horizontal scrolling').toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
}

async function expectNoSerial(fixture: KerfDeskFixture): Promise<void> {
  expect((await fixture.events()).filter((event) => event.kind.startsWith('serial'))).toEqual([]);
}

interface SavedProject {
  readonly machine?: unknown;
  readonly scene: {
    readonly layers: readonly (Readonly<Record<string, unknown>> & {
      readonly cnc?: SavedCncSettings;
    })[];
    readonly objects: readonly Readonly<Record<string, unknown>>[];
  };
}

interface SavedCncSettings {
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly depthPerPassMm: number;
}

function recipeNumbers(settings: SavedCncSettings | undefined): SavedCncSettings {
  if (settings === undefined) throw new Error('Saved operation has no CNC settings');
  const { feedMmPerMin, plungeMmPerMin, spindleRpm, depthPerPassMm } = settings;
  return { feedMmPerMin, plungeMmPerMin, spindleRpm, depthPerPassMm };
}
