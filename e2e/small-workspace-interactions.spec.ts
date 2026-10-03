import type { AppState } from '../src/ui/state/store';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { selectWorkspacePanel, toolbarCommand } from './fixtures/workspace-ui';

test('same-document paste uses current process settings after Copy', async ({ page, kerfdesk }) => {
  await openBasic(page);
  await canvasKeys(page, 'ControlOrMeta+a', 'ControlOrMeta+c');
  const power = page.getByRole('spinbutton', { name: /^Power for/ });
  await power.fill('47');
  await power.press('Tab');
  await canvasKeys(page, 'ControlOrMeta+v');
  const state = await snapshot(page);
  expect(state.project.scene.objects).toHaveLength(2);
  expect(state.project.scene.layers).toHaveLength(1);
  expect(state.project.scene.layers[0]?.power).toBe(47);
  const [original, pasted] = state.project.scene.objects;
  expect(pasted?.id).not.toBe(original?.id);
  expect(pasted?.transform.x).toBe((original?.transform.x ?? 0) + 10);
  expect(pasted?.transform.y).toBe((original?.transform.y ?? 0) + 10);
  await expectNoSerial(kerfdesk.events);
});

test('cross-document Paste in Place preserves copied settings and binds a new operation', async ({
  page,
  kerfdesk,
}) => {
  await openBasic(page);
  const power = page.getByRole('spinbutton', { name: /^Power for/ });
  await power.fill('67');
  await power.press('Tab');
  await canvasKeys(page, 'ControlOrMeta+a', 'ControlOrMeta+c');
  const source = (await snapshot(page)).project.scene;
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Ctrl+N', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Save changes?', exact: true })
    .getByRole('button', { name: "Don't Save", exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page)).project.scene.objects.length).toBe(0);
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Paste in Place/ }).click();
  const scene = (await snapshot(page)).project.scene;
  expect(scene.objects).toHaveLength(1);
  expect(scene.objects[0]?.transform).toEqual(source.objects[0]?.transform);
  expect(scene.objects[0]?.id).not.toBe(source.objects[0]?.id);
  const copied = scene.layers.find((operation) => operation.power === 67);
  expect(copied).toBeDefined();
  expect(copied?.id).not.toBe(source.layers[0]?.id);
  const pasted = scene.objects[0];
  if (pasted?.kind !== 'imported-svg') throw new Error('Copied vector missing');
  expect(pasted.paths[0]?.operationIds).toEqual([copied?.id]);
  await expectNoSerial(kerfdesk.events);
});

test('Cut, undo, paste and redo keep artwork and operation ownership consistent', async ({
  page,
  kerfdesk,
}) => {
  await openBasic(page);
  const original = (await snapshot(page)).project;
  await canvasKeys(page, 'ControlOrMeta+a', 'ControlOrMeta+x');
  expect((await snapshot(page)).project.scene.objects).toHaveLength(0);
  await canvasKeys(page, 'ControlOrMeta+z');
  expect((await snapshot(page)).project).toEqual(original);
  await canvasKeys(page, 'ControlOrMeta+v');
  expect((await snapshot(page)).project.scene.objects).toHaveLength(2);
  await canvasKeys(page, 'ControlOrMeta+z');
  expect((await snapshot(page)).project).toEqual(original);
  await canvasKeys(page, 'ControlOrMeta+Shift+z');
  const scene = (await snapshot(page)).project.scene;
  expect(scene.objects).toHaveLength(2);
  expect(scene.layers).toHaveLength(1);
  expect(new Set(scene.objects.map((object) => object.id)).size).toBe(2);
  await expectNoSerial(kerfdesk.events);
});

test('duplicate, delete-all, undo and redo retire stale selections', async ({ page, kerfdesk }) => {
  await openBasic(page);
  await canvasKeys(page, 'ControlOrMeta+a', 'ControlOrMeta+d');
  expect((await snapshot(page)).project.scene.objects).toHaveLength(2);
  await canvasKeys(page, 'ControlOrMeta+a', 'Delete');
  const deleted = await snapshot(page);
  expect(deleted.project.scene.objects).toHaveLength(0);
  expect(deleted.selected).toEqual([]);
  await canvasKeys(page, 'ControlOrMeta+z');
  expect((await snapshot(page)).project.scene.objects).toHaveLength(2);
  await canvasKeys(page, 'ControlOrMeta+Shift+z');
  expect((await snapshot(page)).project.scene.objects).toHaveLength(0);
  await expectNoSerial(kerfdesk.events);
});

test('Settings owns workspace shortcuts while its dialog is open', async ({ page, kerfdesk }) => {
  await openBasic(page);
  await canvasKeys(page, 'ControlOrMeta+a', 'ControlOrMeta+c');
  const before = await snapshot(page);
  await page.keyboard.press('ControlOrMeta+,');
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  for (const chord of ['ControlOrMeta+n', 'ControlOrMeta+d', 'ControlOrMeta+v', 'Delete']) {
    await page.keyboard.press(chord);
  }
  expect(await snapshot(page)).toEqual(before);
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expectNoSerial(kerfdesk.events);
});

for (const viewport of [
  { width: 1024, height: 600 },
  { width: 640, height: 450 },
]) {
  test(`resizing, collapsing panels and toolbar Save preserve the job at ${viewport.width}x${viewport.height}`, async ({
    page,
    kerfdesk,
  }) => {
    await openBasic(page);
    const power = page.getByRole('spinbutton', { name: /^Power for/ });
    await power.fill('43');
    await power.press('Tab');
    const before = await snapshot(page);
    await page.setViewportSize(viewport);
    await selectWorkspacePanel(page, 'Artwork');
    await page
      .getByRole('button', { name: 'Collapse Artwork / Operations panel', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Expand Artwork / Operations panel', exact: true })
      .click();
    await selectWorkspacePanel(page, 'Machine');
    await page.getByRole('button', { name: 'Collapse Laser panel', exact: true }).click();
    await page.getByRole('button', { name: 'Expand Laser panel', exact: true }).click();
    await selectWorkspacePanel(page, 'Artwork');
    expect(await snapshot(page)).toEqual(before);
    for (const name of ['Frame job', 'Start']) {
      const action = page.getByRole('button', { name, exact: true });
      if (viewport.height < 600) await action.scrollIntoViewIfNeeded();
      expect(
        await action.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const dock = element.closest('.lf-workspace-job-actions')?.getBoundingClientRect();
          const rail = element.closest('.lf-workspace-panels')?.getBoundingClientRect();
          const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return (
            dock !== undefined &&
            rail !== undefined &&
            box.x >= rail.x &&
            box.right <= rail.right &&
            box.y >= rail.y &&
            box.bottom <= rail.bottom &&
            box.x >= dock.x &&
            box.right <= dock.right &&
            box.y >= 0 &&
            box.bottom <= window.innerHeight &&
            box.y >= dock.y &&
            box.bottom <= dock.bottom &&
            target !== null &&
            element.contains(target)
          );
        }),
      ).toBe(true);
    }
    const save = await toolbarCommand(page, 'Save As...');
    await save.click();
    await expect
      .poll(async () => Object.keys(await kerfdesk.savedFiles()).length)
      .toBeGreaterThan(0);
    const saved = Object.values(await kerfdesk.savedFiles()).at(-1);
    if (saved === undefined) throw new Error('Saved project missing');
    const project = JSON.parse(saved) as AppState['project'];
    expect(project.scene).toEqual(before.project.scene);
    expect(project.scene.layers[0]?.power).toBe(43);
    await expectNoSerial(kerfdesk.events);
  });
}

async function openBasic(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/, { timeout: 30_000 });
  await expect(page.getByRole('spinbutton', { name: /^Power for/ })).toBeVisible();
}

async function canvasKeys(page: Page, ...chords: readonly string[]): Promise<void> {
  // The drawing canvas is not a tab stop. Move focus out of any number field
  // through a real toolbar control without changing the artwork selection.
  await page.getByRole('button', { name: 'More commands', exact: true }).focus();
  for (const chord of chords) await page.keyboard.press(chord);
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const url = '/src/ui/state/index.ts';
    const { useStore } = (await import(url)) as { useStore: { getState: () => AppState } };
    const state = useStore.getState();
    return {
      project: state.project,
      selected: [
        ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
        ...state.additionalSelectedIds,
      ],
      undo: state.undoStack.length,
      redo: state.redoStack.length,
    };
  });
}

async function expectNoSerial(
  events: () => Promise<readonly { readonly kind: string }[]>,
): Promise<void> {
  expect((await events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
}
