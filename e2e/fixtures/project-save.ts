import { expect, type KerfDeskFixture, type Page } from './kerfdesk-test';
import { toolbarCommand } from './workspace-ui';

/** Save through the rendered preparation and picker flow, preserving artifact checks at callers. */
export async function saveProjectAs(
  page: Page,
  fixture: KerfDeskFixture,
  options: { readonly expectPreparation?: boolean } = {},
): Promise<void> {
  const pickerCount = async () =>
    (await fixture.events()).filter((event) => event.kind === 'picker-save').length;
  const before = await pickerCount();
  await (await toolbarCommand(page, 'Save As...')).click();
  const dialog = page.getByRole('dialog', { name: 'Save project', exact: true });
  if (options.expectPreparation === true) await expect(dialog).toBeVisible();
  else {
    await expect
      .poll(async () => (await dialog.isVisible()) || (await pickerCount()) > before)
      .toBe(true);
  }
  if (await dialog.isVisible()) {
    // Preparation must finish before a real second click opens any file picker.
    expect(await pickerCount()).toBe(before);
    const choose = dialog.getByRole('button', { name: 'Choose file…', exact: true });
    await expect(choose).toBeEnabled({ timeout: 60_000 });
    await expect(dialog).toContainText('Your project is ready.');
    expect(await pickerCount()).toBe(before);
    await choose.click();
    await expect(dialog).toBeHidden();
  }
  await expect.poll(pickerCount).toBe(before + 1);
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
