import type { Project } from '../../src/core/scene';
import { expect, type KerfDeskFixture, type Page } from './kerfdesk-test';
import { toolbarCommand } from './workspace-ui';

/** Read-only evidence; all changes in this test use the rendered controls. */
export async function barcodeAcceptanceSnapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const loaded = (await import(/* @vite-ignore */ path)) as {
      useStore: {
        getState: () => {
          project: Project;
          selectedObjectId: string | null;
          additionalSelectedIds: ReadonlySet<string>;
          undoStack: readonly unknown[];
          redoStack: readonly unknown[];
        };
      };
    };
    const state = loaded.useStore.getState();
    return {
      project: state.project,
      selectedIds: [state.selectedObjectId, ...state.additionalSelectedIds].filter(
        (id) => id !== null,
      ),
      undoCount: state.undoStack.length,
      redoCount: state.redoStack.length,
    };
  });
}

export async function openBarcodeAcceptanceProject(
  page: Page,
  fixture: KerfDeskFixture,
  name: string,
  text: string,
): Promise<void> {
  await fixture.setOpenFiles([{ name, text }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(new RegExp(name.replaceAll('.', '\\.')), { timeout: 30_000 });
}

export async function barcodeAcceptanceHistory(page: Page, redo: boolean): Promise<void> {
  await page.getByLabel('KerfDesk workspace', { exact: true }).focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}

export async function saveBarcodeAcceptanceProject(
  page: Page,
  fixture: KerfDeskFixture,
): Promise<string> {
  const before = (await fixture.events()).filter((event) => event.kind === 'file-saved').length;
  await (await toolbarCommand(page, 'Save As...')).click();
  await expect
    .poll(
      async () => (await fixture.events()).filter((event) => event.kind === 'file-saved').length,
    )
    .toBe(before + 1);
  const name = (await fixture.events()).filter((event) => event.kind === 'file-saved').at(-1)?.[
    'name'
  ];
  const text = typeof name === 'string' ? (await fixture.savedFiles())[name] : undefined;
  if (text === undefined) throw new Error('Barcode acceptance project was not saved');
  return text;
}
