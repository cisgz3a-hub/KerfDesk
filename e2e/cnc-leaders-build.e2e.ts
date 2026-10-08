import { test, expect, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';
import { saveProjectAs } from './fixtures/project-save';
import { benchmarkProject } from '../src/__fixtures__/cnc-leader-fixtures';
test.use({ viewport: { width: 1440, height: 1000 } });
async function openCnc(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await page.goto('/');
  await kerfdesk.setOpenFiles([
    { name: 'cnc-leaders.lf2', text: JSON.stringify(benchmarkProject()) },
  ]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/cnc-leaders\.lf2/);
  const notifications = page.getByRole('button', { name: /^Dismiss .+ notification:/ });
  while (await notifications.count()) await notifications.first().click();
}
async function saveSource(page: Page, kerfdesk: KerfDeskFixture): Promise<Record<string, unknown>> {
  await expect(page).toHaveTitle(/cnc-leaders\.lf2/);
  await expect(
    page.getByRole('group', { name: 'Machine type', exact: true }).getByRole('button', {
      name: 'CNC',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  // Open fixtures expose a read-only handle; Save As supplies the writable capture target.
  await saveProjectAs(page, kerfdesk);
  await expect.poll(async () => (await kerfdesk.savedFiles())['cnc-leaders.lf2']).toBeDefined();
  await expect(page).toHaveTitle(/cnc-leaders\.lf2/);
  const text = (await kerfdesk.savedFiles())['cnc-leaders.lf2'];
  if (text === undefined) throw new Error('The reviewed CNC project was not saved');
  return JSON.parse(text) as Record<string, unknown>;
}

test('sketch editor reviews 75 mm geometry and saved source retains fractional holes', async ({
  page,
  kerfdesk,
}) => {
  await openCnc(page, kerfdesk);
  await page.getByRole('button', { name: 'Create constrained sketch…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Constrained 2D sketch' });
  await dialog.getByLabel('width value or expression', { exact: true }).fill('75');
  await dialog.getByRole('button', { name: 'Review solved geometry' }).click();
  await expect(dialog.getByRole('status')).toContainText('fully-constrained');
  await expect(dialog.getByRole('region', { name: 'Solved sketch preview' })).toContainText(
    '75.000 × 30.000',
  );
  await dialog.getByRole('button', { name: 'Apply reviewed sketch' }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await saveSource(page, kerfdesk);
  const scene = saved['scene'] as {
    objects: {
      constrainedSketch?: { points: { id: string; x: number }[] };
      bounds: { maxX: number };
    }[];
  };
  const object = scene.objects.find((o) => o.constrainedSketch !== undefined);
  expect(object?.bounds.maxX).toBeCloseTo(75, 4);
  expect(object?.constrainedSketch?.points.find((p) => p.id === 'hole1')?.x).toBeCloseTo(18.75, 4);
  await page.screenshot({ path: 'docs/audits/2026-10-08-cnc-leaders/sketch-workspace.png' });
});
test('generated panel preview applies named dimensions and preserves retained generator intent', async ({
  page,
  kerfdesk,
}) => {
  await openCnc(page, kerfdesk);
  await page.getByRole('button', { name: 'Create parametric part…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create generated part' });
  await dialog.getByLabel('Overall width (mm)', { exact: true }).fill('75');
  await dialog.getByRole('button', { name: 'Preview geometry and operations' }).click();
  await expect(dialog.getByRole('button', { name: 'Apply reviewed part' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Apply reviewed part' }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await saveSource(page, kerfdesk);
  const scene = saved['scene'] as {
    objects: { partGenerator?: { definition: { widthMm: number } }; bounds: { maxX: number } }[];
  };
  const object = scene.objects.find((o) => o.partGenerator !== undefined);
  expect(object?.partGenerator?.definition.widthMm).toBe(75);
  expect(object?.bounds.maxX).toBeCloseTo(75, 4);
  await page.screenshot({
    path: 'docs/audits/2026-10-08-cnc-leaders/generated-part-workspace.png',
  });
});
test('editable relief worker creates retained components with the requested physical size', async ({
  page,
  kerfdesk,
}) => {
  await openCnc(page, kerfdesk);
  await page.getByRole('button', { name: 'Create editable relief…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create editable relief', exact: true });
  await dialog.getByLabel('Relief width (mm)', { exact: true }).fill('24');
  await dialog.getByLabel('Relief height (mm)', { exact: true }).fill('20');
  await dialog.getByLabel('Maximum relief depth (mm)', { exact: true }).fill('4');
  await dialog.getByLabel('Authoring grid size (cells per side)', { exact: true }).fill('16');
  await dialog.getByRole('button', { name: 'Create relief', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await saveSource(page, kerfdesk);
  const scene = saved['scene'] as {
    objects: {
      kind: string;
      reliefAuthoring?: { physicalWidthMm: number; physicalHeightMm: number };
      reliefSource?: { width: number; height: number };
    }[];
  };
  const object = scene.objects.find((o) => o.kind === 'relief');
  expect(object?.reliefAuthoring).toMatchObject({ physicalWidthMm: 24, physicalHeightMm: 20 });
  expect(object?.reliefSource).toMatchObject({ width: 16, height: 16 });
});
