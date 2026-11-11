import { readFileSync } from 'node:fs';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { lapseClickActivation } from './fixtures/gcode-save';
import { toolbarCommand } from './fixtures/workspace-ui';

const base = JSON.parse(
  readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const notes = 'background manual save '.repeat(24_000);
const filename = 'background-save.lf2';

async function openLargeProject(page: Page, fixture: KerfDeskFixture): Promise<void> {
  await page.goto('/');
  await fixture.setOpenFiles([{ name: filename, text: JSON.stringify({ ...base, notes }) }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/background-save\.lf2/);
  const power = page.getByRole('spinbutton', { name: /^Power for/ });
  await power.fill('41');
  await power.press('Tab');
  await expect(page).toHaveTitle(/\*$/);
}

const pickerSaves = async (fixture: KerfDeskFixture): Promise<number> =>
  (await fixture.events()).filter((event) => event.kind === 'picker-save').length;

// Annoyance audit A4-P2-4, ADR-656 Amendment 4: validated while the click is
// still active, the project goes straight to the file picker.
test('large manual Save prepares in a real worker and opens its picker with no second click', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await openLargeProject(page, kerfdesk);
  await (await toolbarCommand(page, 'Save As...')).click();
  // Nothing else is clicked: the picker opens from the Save As click itself.
  await expect.poll(() => pickerSaves(kerfdesk), { timeout: 60_000 }).toBe(1);
  await expect(page.getByRole('dialog', { name: 'Save project', exact: true })).toBeHidden();
  await expect
    .poll(() => workers.some((url) => url.includes('project-save-preparation-worker')))
    .toBe(true);
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles())).toEqual([filename]);
  const text = (await kerfdesk.savedFiles())[filename];
  if (text === undefined) throw new Error('The prepared project file was not written.');
  const saved = JSON.parse(text) as {
    notes: string;
    scene: { layers: { power: number }[] };
  };
  expect(saved.notes).toBe(notes);
  expect(saved.scene.layers[0]?.power).toBe(41);
  await expect(page).not.toHaveTitle(/\*$/);
});

test('a large Save validated after the click lapsed asks for Choose file, then saves', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  await openLargeProject(page, kerfdesk);
  await lapseClickActivation(page);
  await (await toolbarCommand(page, 'Save As...')).click();
  const dialog = page.getByRole('dialog', { name: 'Save project', exact: true });
  const choose = dialog.getByRole('button', { name: 'Choose file…', exact: true });
  await expect(choose).toBeEnabled({ timeout: 60_000 });
  await expect(dialog).toContainText('Your project is ready.');
  expect(await pickerSaves(kerfdesk)).toBe(0);
  await choose.click();
  await expect.poll(() => pickerSaves(kerfdesk)).toBe(1);
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles())).toEqual([filename]);
  await expect(page).not.toHaveTitle(/\*$/);
});

test('Cancel after large manual Save preparation keeps edits without selecting or writing a file', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  await openLargeProject(page, kerfdesk);
  // The slow save: its dialog waits for a click, so Cancel can be pressed.
  await lapseClickActivation(page);
  await (await toolbarCommand(page, 'Save As...')).click();
  const dialog = page.getByRole('dialog', { name: 'Save project', exact: true });
  await expect(dialog.getByRole('button', { name: 'Choose file…', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  expect((await kerfdesk.events()).filter((event) => event.kind === 'picker-save')).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await kerfdesk.events()).filter((event) => event.kind === 'picker-save')).toEqual([]);
  expect(await kerfdesk.savedFiles()).toEqual({});
  await expect(page).toHaveTitle(/\*$/);
  await expect(page.getByRole('spinbutton', { name: /^Power for/ })).toHaveValue('41');
});
