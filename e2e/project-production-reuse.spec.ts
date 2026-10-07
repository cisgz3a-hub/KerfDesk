import type { ProductionManifest } from '../src/core/scene/production-manifest';
import { test, expect, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { saveProjectAs } from './fixtures/project-save';
import { toolbarCommand } from './fixtures/workspace-ui';

interface SavedProductionProject {
  readonly scene: unknown;
  readonly productionManifest?: ProductionManifest;
  readonly sheetBook?: {
    readonly activeId: string;
    readonly inactive: readonly { readonly id: string; readonly projectJson: string }[];
  };
}

test('duplicates completed artwork into a separate explicitly allocated run and reopens both observations', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  let production = await openProduction(page);
  await production.getByRole('textbox', { name: 'Run name', exact: true }).fill('Original run');
  await production.getByRole('spinbutton', { name: 'Production rows', exact: true }).fill('1');
  await production.getByRole('button', { name: 'Create production run', exact: true }).click();
  await production.getByRole('button', { name: 'Inspect row 1', exact: true }).click();
  await production.getByRole('button', { name: 'Open fixed row artwork', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Save changes?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: "Don't Save", exact: true }).click();
  await expect(production.getByRole('button', { name: 'Capture working variant' })).toBeEnabled();
  await production.getByRole('button', { name: 'Capture working variant' }).click();
  await expect(production).toContainText('Variant captured');
  await production
    .getByRole('combobox', { name: 'Production row result' })
    .selectOption('completed');
  await production
    .getByRole('textbox', { name: 'Production result notes' })
    .fill('Observed original only');
  await production.getByRole('button', { name: 'Record result', exact: true }).click();
  await expect(production.getByRole('status')).toContainText('Recorded the observed result');
  await closeProduction(page);
  await saveProjectAs(page, kerfdesk);
  const original = await savedProject(kerfdesk);
  const originalManifest = original.productionManifest!;
  expect(originalManifest.rows[0]).toMatchObject({
    status: 'completed',
    notes: 'Observed original only',
  });
  expect(originalManifest.rows[0]?.reviewedProjectJson).toBeTruthy();

  await page.getByRole('button', { name: 'Project sheets…', exact: true }).click();
  const sheets = page.getByRole('dialog', { name: 'Project sheets', exact: true });
  await sheets
    .getByRole('textbox', { name: 'New sheet name', exact: true })
    .fill('Separate repeat');
  await sheets.getByRole('button', { name: 'Duplicate active sheet', exact: true }).click();
  await sheets.getByRole('button', { name: 'Production run…', exact: true }).click();
  production = page.getByRole('dialog', { name: 'Production run', exact: true });
  await expect(production.getByRole('textbox', { name: 'Run name', exact: true })).toBeVisible();
  await production.getByRole('textbox', { name: 'Run name', exact: true }).fill('Separate run');
  await production.getByRole('spinbutton', { name: 'Production rows', exact: true }).fill('1');
  await production.getByRole('button', { name: 'Create production run', exact: true }).click();
  await expect(
    production.getByRole('heading', { name: 'Separate run', exact: true }),
  ).toBeVisible();
  await closeProduction(page);
  await saveProjectAs(page, kerfdesk);
  await expect
    .poll(async () => (await savedProject(kerfdesk)).productionManifest?.name)
    .toBe('Separate run');
  const combined = await savedProject(kerfdesk);
  const fresh = combined.productionManifest!;
  expect(combined.scene).toEqual(original.scene);
  expect(fresh.id).not.toBe(originalManifest.id);
  expect(fresh.rows[0]?.id).not.toBe(originalManifest.rows[0]?.id);
  expect(fresh.activeRowId).toBeUndefined();
  expect(fresh.rows[0]).toMatchObject({ status: 'pending', notes: '' });
  expect(fresh.rows[0]?.reviewedProjectJson).toBeUndefined();
  expect(fresh.rows[0]?.reviewedAt).toBeUndefined();
  expect(fresh.rows[0]?.resultAt).toBeUndefined();
  const archived = combined.sheetBook!.inactive[0]!;
  expect((JSON.parse(archived.projectJson) as SavedProductionProject).productionManifest).toEqual(
    originalManifest,
  );

  await kerfdesk.setOpenFiles([{ name: 'separate-runs.lf2', text: JSON.stringify(combined) }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/separate-runs\.lf2/);
  await page.getByRole('button', { name: 'Project sheets…', exact: true }).click();
  await sheets.getByRole('combobox', { name: 'Active project sheet' }).selectOption(archived.id);
  await sheets.getByRole('button', { name: 'Production run…', exact: true }).click();
  production = page.getByRole('dialog', { name: 'Production run', exact: true });
  await expect(
    production.getByRole('heading', { name: 'Original run', exact: true }),
  ).toBeVisible();
  await production.getByRole('button', { name: 'Inspect row 1', exact: true }).click();
  await expect(production.getByRole('combobox', { name: 'Production row result' })).toHaveValue(
    'completed',
  );
  await expect(production.getByRole('textbox', { name: 'Production result notes' })).toHaveValue(
    'Observed original only',
  );
  await expect(
    production.getByRole('button', { name: 'Open reviewed variant', exact: true }),
  ).toBeVisible();
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
});

async function openProduction(page: Page) {
  await page.getByRole('button', { name: 'Project sheets…', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Project sheets', exact: true })
    .getByRole('button', { name: 'Production run…', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Production run', exact: true });
}
async function closeProduction(page: Page): Promise<void> {
  await page
    .getByRole('dialog', { name: 'Production run', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Project sheets', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
}
async function savedProject(fixture: KerfDeskFixture): Promise<SavedProductionProject> {
  await expect
    .poll(async () => Object.keys(await fixture.savedFiles()).some((name) => name.endsWith('.lf2')))
    .toBe(true);
  const files = await fixture.savedFiles();
  const saved = Object.entries(files).find(([name]) => name.endsWith('.lf2'));
  if (saved === undefined) throw new Error('No saved production project');
  return JSON.parse(saved[1]) as SavedProductionProject;
}
