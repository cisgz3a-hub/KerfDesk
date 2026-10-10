import {
  expect,
  test,
  type Locator,
  type Page,
  type KerfDeskFixture,
} from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

test('independent wall finish values survive UI editing, compilation and save/reopen', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/, { timeout: 30_000 });
  const artworkTab = page
    .getByRole('tablist', { name: 'Side panel', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true });
  if (await artworkTab.isVisible()) await artworkTab.click();
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await page
    .getByRole('group', { name: 'Machine type', exact: true })
    .getByRole('button', { name: 'CNC', exact: true })
    .click();
  await panel.getByRole('combobox', { name: /^Cut type for/ }).selectOption('profile-outside');
  await number(panel, /^Cut depth for/, '3');
  await number(panel, /^Feed for/, '900');
  await openSection(panel, /^Wall finish/);
  await number(panel, /^Finish allowance for/, '0.2');
  await openSection(panel, /^Stage cutting values/);
  const separate = panel.getByRole('checkbox', {
    name: 'Separate values for wall finishing',
    exact: true,
  });
  await separate.check();
  await number(panel, /^Wall finishing feed for/, '321');
  await number(panel, /^Wall finishing plunge for/, '72');
  await number(panel, /^Wall finishing spindle speed for/, '7100');
  await number(panel, /^Wall finishing depth per pass for/, '0.7');
  await expect(panel.getByRole('spinbutton', { name: /^Feed for/ })).toHaveValue('900');

  const groups = await compiledGroups(page);
  expect(groups.some((group) => group.feedMmPerMin === 900)).toBe(true);
  const finishing = groups.filter((group) => group.feedMmPerMin === 321);
  expect(finishing.length).toBeGreaterThan(0);
  for (const group of finishing) {
    expect(group.spindleRpm).toBe(7100);
    expect(group.plungeMmPerMin).toBe(72);
    expect(group.passes).toBeGreaterThan(1);
  }
  const saved = await saveProject(page, kerfdesk);
  await kerfdesk.setOpenFiles([{ name: 'stage-recipes-roundtrip.lf2', text: saved }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/stage-recipes-roundtrip\.lf2/, { timeout: 30_000 });
  await openSection(panel, /^Stage cutting values/);
  await expect(separate).toBeChecked();
  await expect(panel.getByRole('spinbutton', { name: /^Wall finishing feed for/ })).toHaveValue(
    '321',
  );
  await expect(
    panel.getByRole('spinbutton', { name: /^Wall finishing depth per pass for/ }),
  ).toHaveValue('0.7');
  expect(await compiledGroups(page)).toEqual(groups);
  await separate.uncheck();
  expect((await compiledGroups(page)).some((group) => group.feedMmPerMin === 321)).toBe(false);
  await separate.check();
  await panel
    .getByRole('spinbutton', { name: /^Wall finishing feed for/ })
    .scrollIntoViewIfNeeded();
  await panel.screenshot({ path: testInfo.outputPath('stage-cutting-values.png') });
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial'))).toEqual([]);
});

async function number(panel: Locator, name: RegExp, value: string): Promise<void> {
  const input = panel.getByRole('spinbutton', { name });
  await input.fill(value);
  await input.press('Tab');
  await expect(input).toHaveValue(value);
}

async function openSection(panel: Locator, name: RegExp): Promise<void> {
  const summary = panel.locator('summary').filter({ hasText: name });
  if ((await summary.locator('..').getAttribute('open')) === null) await summary.click();
}

async function saveProject(page: Page, fixture: KerfDeskFixture): Promise<string> {
  const before = (await fixture.events()).filter((event) => event.kind === 'file-saved').length;
  await (await toolbarCommand(page, 'Save As...')).click();
  await expect
    .poll(
      async () => (await fixture.events()).filter((event) => event.kind === 'file-saved').length,
    )
    .toBeGreaterThan(before);
  const name = (await fixture.events()).filter((event) => event.kind === 'file-saved').at(-1)?.[
    'name'
  ];
  const text = typeof name === 'string' ? (await fixture.savedFiles())[name] : undefined;
  if (text === undefined) throw new Error('No saved project');
  return text;
}

async function compiledGroups(page: Page) {
  return page.evaluate(async () => {
    const statePath = '/src/ui/state/store.ts';
    const compilePath = '/src/core/cnc/compile-cnc-job.ts';
    const { useStore } = (await import(statePath)) as {
      useStore: {
        getState: () => { project: { scene: unknown; device: unknown; machine: unknown } };
      };
    };
    const { compileCncJob } = (await import(compilePath)) as {
      compileCncJob: (
        scene: unknown,
        device: unknown,
        machine: unknown,
      ) => {
        groups: {
          feedMmPerMin: number;
          plungeMmPerMin: number;
          spindleRpm: number;
          passes: unknown[];
        }[];
      };
    };
    const project = useStore.getState().project;
    return compileCncJob(project.scene, project.device, project.machine).groups.map((group) => ({
      feedMmPerMin: group.feedMmPerMin,
      plungeMmPerMin: group.plungeMmPerMin,
      spindleRpm: group.spindleRpm,
      passes: group.passes.length,
    }));
  });
}
