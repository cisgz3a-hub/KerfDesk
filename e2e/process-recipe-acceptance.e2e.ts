import { writeFile } from 'node:fs/promises';
import type { Layer, Project } from '../src/core/scene';
import { expect, test, type Locator } from './fixtures/kerfdesk-test';
import { applicationHeader } from './fixtures/workspace-ui';
import {
  RECIPE_CUTTER,
  recipeAcceptanceSource,
  recipeAcceptanceTargets,
} from './fixtures/process-recipe-acceptance-project';
import {
  openRecipeAcceptanceProject,
  recipeAcceptanceSnapshot,
  recipeArtworkPanel,
  recipeHistory,
  recipePanelView,
  saveRecipeAcceptanceProject,
  selectAllRecipeArtwork,
  selectRecipeTarget,
} from './fixtures/process-recipe-acceptance-browser';

test.use({ viewport: { width: 1366, height: 900 } });

for (const cnc of [false, true]) {
  const kind = cnc ? 'CNC' : 'Laser';
  test(`${kind} complete process recipe captures, applies independently, undoes and reopens`, async ({
    page,
    kerfdesk,
  }, testInfo) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await expect(applicationHeader(page)).toContainText('KerfDesk', { timeout: 90_000 });
    await expect(page.locator('#app-splash')).toHaveCount(0);
    await openRecipeAcceptanceProject(
      page,
      kerfdesk,
      `${kind}-source.lf2`,
      JSON.stringify(recipeAcceptanceSource(cnc)),
    );
    await selectAllRecipeArtwork(page);
    const source = await recipeAcceptanceSnapshot(page);
    expect(source.selectedIds).toEqual(['source']);
    await recipePanelView(page, cnc ? 'Recipes' : 'Materials');
    await page.getByRole('button', { name: 'Create new material library', exact: true }).click();
    const recipes = page.getByRole('region', { name: 'Process recipes', exact: true });
    const name = `${kind} ordered acceptance recipe`;
    await recipes.getByLabel('Process recipe name', { exact: true }).fill(name);
    await recipes.getByRole('button', { name: 'Save selected process', exact: true }).click();
    await expect(recipes.getByRole('status')).toHaveText(`Saved ${name} (3 steps).`);
    await expect(recipes.getByLabel('Recipe operation order').getByRole('listitem')).toHaveText(
      cnc
        ? [
            'Engrave: engrave, 500 mm/min, 0.5 mm deep',
            'Optional score: profile-on-path, 750 mm/min, 0.8 mm deep (disabled) (hidden)',
            'Cut: profile-on-path, 300 mm/min, 1.2 mm deep',
          ]
        : [
            'Engrave: fill, 15%, 600 mm/min, 1 pass',
            'Optional score: line, 10%, 1200 mm/min, 3 passes (disabled) (hidden)',
            'Cut: line, 40%, 900 mm/min, 2 passes',
          ],
    );
    const captured = await recipeAcceptanceSnapshot(page);
    expect(captured.project).toEqual(source.project);
    expect(captured.undoCount).toBe(source.undoCount);
    expect(captured.library?.processRecipes).toHaveLength(1);
    const capturedRecipe = required(captured.library?.processRecipes?.[0]);
    if (cnc) expect(captured.library?.processRecipes?.[0]?.tools).toEqual([RECIPE_CUTTER]);
    await page.screenshot({ path: testInfo.outputPath(`${kind}-captured.png`), fullPage: true });

    await openRecipeAcceptanceProject(
      page,
      kerfdesk,
      `${kind}-targets.lf2`,
      JSON.stringify(recipeAcceptanceTargets(cnc)),
    );
    await selectAllRecipeArtwork(page);
    const before = await recipeAcceptanceSnapshot(page);
    expect(before.selectedIds.sort()).toEqual(['fresh-a', 'fresh-b']);
    await recipePanelView(page, cnc ? 'Recipes' : 'Materials');
    await expect(recipes.getByLabel('Saved process recipe')).toHaveValue(capturedRecipe.id);
    await recipes.getByRole('button', { name: 'Apply recipe to selection', exact: true }).click();
    await expect(recipes.getByRole('status')).toHaveText(`Applied ${name} to 2 artworks.`);
    const applied = await recipeAcceptanceSnapshot(page);
    assertRecipeBindings(applied.project, cnc);
    assertDestinationPreserved(before.project, applied.project);
    expect(applied.undoCount).toBe(before.undoCount + 1);
    await recipeHistory(page, false);
    await expect
      .poll(async () => (await recipeAcceptanceSnapshot(page)).project)
      .toEqual(before.project);
    await recipeHistory(page, true);
    await expect
      .poll(async () => (await recipeAcceptanceSnapshot(page)).project)
      .toEqual(applied.project);

    await selectRecipeTarget(page, 0);
    expect((await recipeAcceptanceSnapshot(page)).selectedIds).toEqual(['fresh-a']);
    const first = targetOperations(applied.project, 'fresh-a');
    const firstOperation = required(first[0]);
    const inspector = recipeArtworkPanel(page);
    await assertRenderedSteps(inspector, first, cnc);
    await page.screenshot({
      path: testInfo.outputPath(`${kind}-applied-disabled.png`),
      fullPage: true,
    });
    await inspector
      .getByLabel('Operation to inspect', { exact: true })
      .selectOption(firstOperation.id);
    const field = inspector.getByRole('spinbutton', { name: cnc ? /^Feed for/ : /^Power for/ });
    await field.fill(cnc ? '575' : '17');
    await field.press('Tab');
    await expect(field).toHaveValue(cnc ? '575' : '17');
    const edited = await recipeAcceptanceSnapshot(page);
    expect(targetOperations(edited.project, 'fresh-b')).toEqual(
      targetOperations(applied.project, 'fresh-b'),
    );
    expect(edited.library?.processRecipes).toEqual(captured.library?.processRecipes);
    await selectRecipeTarget(page, 1);
    await inspector
      .getByLabel('Operation to inspect', { exact: true })
      .selectOption(required(targetOperations(edited.project, 'fresh-b')[0]).id);
    await expect(
      inspector.getByRole('spinbutton', { name: cnc ? /^Feed for/ : /^Power for/ }),
    ).toHaveValue(cnc ? '500' : '15');
    await page.screenshot({
      path: testInfo.outputPath(`${kind}-independent-peer.png`),
      fullPage: true,
    });

    const saved = await saveRecipeAcceptanceProject(page, kerfdesk);
    const savedProject = JSON.parse(saved) as Project;
    // Save captures the current UI selection into the document's output scope.
    expect(savedProject.jobSetup).toEqual({
      ...edited.project.jobSetup,
      outputScope: { ...edited.project.jobSetup.outputScope, selectedObjectIds: ['fresh-b'] },
    });
    const savedPath = testInfo.outputPath(`${kind}-saved-project.lf2`);
    await writeFile(savedPath, saved, 'utf8');
    await testInfo.attach(`${kind}-saved-project.lf2`, {
      path: savedPath,
      contentType: 'application/json',
    });
    await openRecipeAcceptanceProject(page, kerfdesk, `${kind}-reopened.lf2`, saved);
    const reopened = await recipeAcceptanceSnapshot(page);
    expect(reopened.project.scene).toEqual(edited.project.scene);
    expect(reopened.project.machine).toEqual(edited.project.machine);
    expect(reopened.project.jobSetup).toEqual(savedProject.jobSetup);
    await selectRecipeTarget(page, 0);
    await inspector
      .getByLabel('Operation to inspect', { exact: true })
      .selectOption(firstOperation.id);
    await expect(
      inspector.getByRole('spinbutton', { name: cnc ? /^Feed for/ : /^Power for/ }),
    ).toHaveValue(cnc ? '575' : '17');
    await recipePanelView(page, cnc ? 'Recipes' : 'Materials');
    await expect(recipes.getByLabel('Saved process recipe').locator('option:checked')).toHaveText(
      name,
    );
    await page.screenshot({ path: testInfo.outputPath(`${kind}-reopened.png`), fullPage: true });
    const events = await kerfdesk.events();
    expect(events.filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
    const evidencePath = testInfo.outputPath(`${kind}-state-evidence.json`);
    await writeFile(
      evidencePath,
      JSON.stringify({ captured, before, applied, edited, reopened, events }, null, 2),
      'utf8',
    );
    await testInfo.attach(`${kind}-state-evidence.json`, {
      path: evidencePath,
      contentType: 'application/json',
    });
  });
}

function targetOperations(project: Project, id: string): Layer[] {
  const object = required(project.scene.objects.find((candidate) => candidate.id === id));
  return project.scene.layers.filter((operation) => object.operationIds?.includes(operation.id));
}

function assertRecipeBindings(project: Project, cnc: boolean): void {
  const first = targetOperations(project, 'fresh-a');
  const second = targetOperations(project, 'fresh-b');
  expect(new Set([...first, ...second].map((operation) => operation.id)).size).toBe(6);
  for (const operations of [first, second]) {
    expect(operations.map((operation) => operation.name)).toEqual([
      'Engrave',
      'Optional score',
      'Cut',
    ]);
    expect(operations.map((operation) => operation.output)).toEqual([true, false, true]);
    expect(operations.map((operation) => operation.visible)).toEqual([true, false, true]);
    if (cnc) {
      expect(operations.map((operation) => operation.cnc?.feedMmPerMin)).toEqual([500, 750, 300]);
      expect(operations.map((operation) => operation.cnc?.depthMm)).toEqual([0.5, 0.8, 1.2]);
      expect(operations.map((operation) => operation.cnc?.toolId)).toEqual(
        Array(3).fill(`${RECIPE_CUTTER.id}-recipe-2`),
      );
    } else {
      expect(operations.map((operation) => operation.power)).toEqual([15, 10, 40]);
      expect(operations.map((operation) => operation.speed)).toEqual([600, 1200, 900]);
      expect(operations.map((operation) => operation.passes)).toEqual([1, 3, 2]);
    }
  }
  if (project.machine?.kind === 'cnc')
    expect(project.machine.tools).toContainEqual({
      ...RECIPE_CUTTER,
      id: `${RECIPE_CUTTER.id}-recipe-2`,
    });
}

function assertDestinationPreserved(before: Project, after: Project): void {
  expect(after.workspace).toEqual(before.workspace);
  expect(after.jobSetup).toEqual(before.jobSetup);
  expect(after.notes).toEqual(before.notes);
  if (before.machine?.kind === 'cnc' && after.machine?.kind === 'cnc') {
    expect({ ...after.machine, tools: before.machine.tools }).toEqual(before.machine);
    expect(after.machine.tools[0]).toEqual(before.machine.tools[0]);
  }
  for (const original of before.scene.objects) {
    const applied = required(after.scene.objects.find((object) => object.id === original.id));
    expect(applied.bounds).toEqual(original.bounds);
    expect(applied.transform).toEqual(original.transform);
    if ('paths' in original && 'paths' in applied) expect(applied.paths).toEqual(original.paths);
  }
}

async function assertRenderedSteps(
  panel: Locator,
  operations: readonly Layer[],
  cnc: boolean,
): Promise<void> {
  for (const index of [0, 2, 1]) {
    const operation = required(operations[index]);
    await panel.getByLabel('Operation to inspect', { exact: true }).selectOption(operation.id);
    await expect(
      panel.getByRole('checkbox', { name: `Output ${operation.name}`, exact: true }),
    ).toBeChecked({ checked: index !== 1 });
    await expect(
      panel.getByRole('checkbox', { name: `Show ${operation.name}`, exact: true }),
    ).toBeChecked({ checked: index !== 1 });
    if (cnc) {
      const settings = required(operation.cnc);
      await expect(panel.getByRole('spinbutton', { name: /^Feed for/ })).toHaveValue(
        String(settings.feedMmPerMin),
      );
      await expect(panel.getByRole('spinbutton', { name: /^Cut depth for/ })).toHaveValue(
        String(settings.depthMm),
      );
      await expect(
        panel.getByRole('combobox', { name: /^Bit for/ }).locator('option:checked'),
      ).toContainText(RECIPE_CUTTER.name);
      await expect(panel.getByRole('combobox', { name: /^Bit for/ })).toHaveValue(
        required(settings.toolId),
      );
    } else {
      await expect(panel.getByRole('spinbutton', { name: /^Power for/ })).toHaveValue(
        String(operation.power),
      );
      await expect(panel.getByRole('spinbutton', { name: /^Speed for/ })).toHaveValue(
        String(operation.speed),
      );
      await expect(panel.getByRole('spinbutton', { name: /^Passes for/ })).toHaveValue(
        String(operation.passes),
      );
    }
  }
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('Recipe acceptance fixture value missing');
  return value;
}
