import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

const fixtureText = readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8');

test('an old discard question cannot erase the project opened by an already pending read', async ({
  page,
  kerfdesk,
}) => {
  await openFixture(page);
  await kerfdesk.setOpenFiles([{ name: 'replacement.lf2', text: fixtureText }]);
  await holdNextProjectRead(page);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__documentReadReady))).toBe(true);
  const power = page.getByRole('spinbutton', { name: /^Power for/ });
  await power.fill('73');
  await power.press('Tab');
  await requestNew(page);
  const question = page.getByRole('dialog', { name: 'Save changes?', exact: true });
  await expect(question).toBeVisible();
  await expect(question).toContainText('project-basic.lf2');
  await page.evaluate(() => window.__finishDocumentRead?.());
  await expect(page).toHaveTitle(/replacement\.lf2/);
  await question.getByRole('button', { name: "Don't Save", exact: true }).click();
  await expect(question).toBeHidden();
  await expect(page).toHaveTitle(/replacement\.lf2/);
  await expect(power).toHaveValue('30');
  await expect(page.getByLabel('Selection width', { exact: true })).toHaveValue('20');
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
});

test('Cancel machine draft keeps committed settings and one Save can be undone and redone', async ({
  page,
  kerfdesk,
}) => {
  await openFixture(page);
  const original = await machineEssentials(page);
  await original.getByRole('spinbutton', { name: 'Bed width (mm)', exact: true }).fill('321');
  await original.getByRole('spinbutton', { name: 'Bed width (mm)', exact: true }).press('Tab');
  await original.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  let dialog = await machineEssentials(page);
  await expect(dialog.getByRole('spinbutton', { name: 'Bed width (mm)', exact: true })).toHaveValue(
    '300',
  );
  const width = dialog.getByRole('spinbutton', { name: 'Bed width (mm)', exact: true });
  await width.fill('321');
  await width.press('Tab');
  await dialog.getByRole('button', { name: 'Review setup', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save machine setup', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  dialog = await machineEssentials(page);
  await expect(dialog.getByRole('spinbutton', { name: 'Bed width (mm)', exact: true })).toHaveValue(
    '300',
  );
  await dialog.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  dialog = await machineEssentials(page);
  await expect(dialog.getByRole('spinbutton', { name: 'Bed width (mm)', exact: true })).toHaveValue(
    '321',
  );
  await dialog.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
});

test('Cancel New, Cancel Open and an invalid file keep the current artwork and process settings', async ({
  page,
  kerfdesk,
}) => {
  await openFixture(page);
  const power = page.getByRole('spinbutton', { name: /^Power for/ });
  await power.fill('73');
  await power.press('Tab');
  await requestNew(page);
  const question = page.getByRole('dialog', { name: 'Save changes?', exact: true });
  await question.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await expect(power).toHaveValue('73');
  await (await toolbarCommand(page, 'Open...')).click();
  await question.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(power).toHaveValue('73');
  await kerfdesk.setOpenFiles([{ name: 'broken.lf2', text: '{this is not a project}' }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await question.getByRole('button', { name: "Don't Save", exact: true }).click();
  await expect(page.getByText(/Could not open broken\.lf2:/)).toBeVisible();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await expect(power).toHaveValue('73');
  await expect(page.getByLabel('Selection width', { exact: true })).toHaveValue('20');
});

test('a failed save from New leaves the edited artwork on the canvas', async ({
  page,
  kerfdesk,
}) => {
  await page.addInitScript(() => {
    const original = window.showOpenFilePicker;
    window.showOpenFilePicker = async (options) =>
      (await original(options)).map((handle) => ({
        ...handle,
        createWritable: async () => {
          throw new DOMException('The folder is read-only', 'NotAllowedError');
        },
      })) as unknown as FileSystemFileHandle[];
  });
  await openFixture(page);
  const power = page.getByRole('spinbutton', { name: /^Power for/ });
  await power.fill('73');
  await power.press('Tab');
  await requestNew(page);
  await page
    .getByRole('dialog', { name: 'Save changes?', exact: true })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(page.getByText(/Could not save project: The folder is read-only/)).toBeVisible();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await expect(power).toHaveValue('73');
  await expect(page.getByLabel('Selection width', { exact: true })).toHaveValue('20');
  expect(await kerfdesk.savedFiles()).toEqual({});
});

test('deleting the last artwork retires its settings and Undo restores them', async ({
  page,
  kerfdesk,
}) => {
  await openFixture(page);
  const power = page.getByRole('spinbutton', { name: /^Power for/ });
  await power.fill('73');
  await power.press('Tab');
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete Delete', exact: true }).click();
  await expect(power).toBeHidden();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(power).toHaveValue('73');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(power).toBeHidden();
  await kerfdesk.setOpenFiles([
    {
      name: 'new-artwork.svg',
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><path d="M2 2H18V18H2Z" fill="none" stroke="#ff0000"/></svg>',
    },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(power).toHaveValue('30');
  await expect(page.getByRole('spinbutton', { name: /^Speed for/ })).toHaveValue('1500');
});

async function openFixture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
}

async function requestNew(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Ctrl+N', exact: true }).click();
}

async function machineEssentials(page: Page) {
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  await dialog.getByRole('button', { name: 'Check essentials', exact: true }).click();
  return dialog;
}

async function holdNextProjectRead(page: Page): Promise<void> {
  await page.evaluate(() => {
    const original = window.showOpenFilePicker;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    window.__finishDocumentRead = release;
    window.showOpenFilePicker = async (options) => {
      const handles = await original(options);
      return handles.map((handle) => ({
        kind: 'file' as const,
        name: handle.name,
        getFile: async () => {
          window.__documentReadReady = true;
          await gate;
          return handle.getFile();
        },
      })) as unknown as FileSystemFileHandle[];
    };
  });
}

declare global {
  interface Window {
    __documentReadReady?: boolean;
    __finishDocumentRead?: () => void;
  }
}
