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
