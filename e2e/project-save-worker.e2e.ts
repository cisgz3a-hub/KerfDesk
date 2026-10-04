import { readFileSync } from 'node:fs';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { saveProjectAs } from './fixtures/project-save';
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

test('large manual Save prepares in a real worker and opens its picker only after Choose file', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await openLargeProject(page, kerfdesk);
  await saveProjectAs(page, kerfdesk, { expectPreparation: true });
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

test('Cancel after large manual Save preparation keeps edits without selecting or writing a file', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  await openLargeProject(page, kerfdesk);
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
