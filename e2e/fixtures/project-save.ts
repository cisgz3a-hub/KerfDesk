import { clickDialogButtonIfReady } from './dialog-button-now';
import { expect, type KerfDeskFixture, type Page } from './kerfdesk-test';
import { toolbarCommand } from './workspace-ui';

/**
 * Save As through to the file picker, preserving artifact checks at callers.
 *
 * A project that is ready while the click is still active opens the picker at
 * once: with no dialog when it is quick, or from the Save project dialog by
 * itself when it took longer. Only a project ready after the activation lapsed
 * waits for a click on Choose file… (ADR-656 Amendment 4).
 */
export async function saveProjectAs(page: Page, fixture: KerfDeskFixture): Promise<void> {
  const pickerCount = async () =>
    (await fixture.events()).filter((event) => event.kind === 'picker-save').length;
  const before = await pickerCount();
  await (await toolbarCommand(page, 'Save As...')).click();
  const dialog = page.getByRole('dialog', { name: 'Save project', exact: true });
  const choose = dialog.getByRole('button', { name: 'Choose file…', exact: true });
  await expect
    .poll(
      async () => {
        if ((await pickerCount()) > before) return true;
        // The dialog may close under the click when the picker opens by itself.
        await clickDialogButtonIfReady(choose);
        return (await pickerCount()) > before;
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  await expect(dialog).toBeHidden();
  expect(await pickerCount()).toBe(before + 1);
}

/** One object of a saved project, read by field rather than by its JSON text. */
export type SavedSceneObject = Readonly<Record<string, unknown>>;

/**
 * The scene objects of every saved project file. Manual saves are compact JSON
 * since ADR-204 Amendment 2, so callers parse instead of matching indented text.
 */
export async function savedSceneObjects(
  fixture: KerfDeskFixture,
): Promise<readonly SavedSceneObject[]> {
  return Object.values(await fixture.savedFiles()).flatMap((text) => {
    let project: unknown;
    try {
      project = JSON.parse(text);
    } catch {
      return [];
    }
    const objects = (project as { scene?: { objects?: unknown } } | null)?.scene?.objects;
    return Array.isArray(objects) ? (objects as SavedSceneObject[]) : [];
  });
}
