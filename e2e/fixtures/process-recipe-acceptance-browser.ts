import type { Project } from '../../src/core/scene';
import type { MaterialLibraryDocument } from '../../src/io/material-library';
import { expect, type KerfDeskFixture, type Locator, type Page } from './kerfdesk-test';
import { toolbarCommand } from './workspace-ui';

export async function recipeAcceptanceSnapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const loaded = (await import(/* @vite-ignore */ path)) as {
      useStore: {
        getState: () => {
          project: Project;
          materialLibrary: MaterialLibraryDocument | null;
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
      library: state.materialLibrary,
      selectedIds: [state.selectedObjectId, ...state.additionalSelectedIds].filter(
        (id) => id !== null,
      ),
      undoCount: state.undoStack.length,
      redoCount: state.redoStack.length,
    };
  });
}

export async function openRecipeAcceptanceProject(
  page: Page,
  fixture: KerfDeskFixture,
  name: string,
  text: string,
): Promise<void> {
  await fixture.setOpenFiles([{ name, text }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(new RegExp(name.replaceAll('.', '\\.')), { timeout: 30_000 });
  const sideTab = page
    .getByRole('tablist', { name: 'Side panel', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true });
  if (await sideTab.isVisible()) await sideTab.click();
}

export function recipeArtworkPanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Artwork / Operations panel', exact: true });
}

export async function recipePanelView(page: Page, name: string): Promise<void> {
  await recipeArtworkPanel(page)
    .getByRole('tablist', { name: 'Artwork panel view', exact: true })
    .getByRole('tab', { name, exact: true })
    .click();
}

export async function selectAllRecipeArtwork(page: Page): Promise<void> {
  await page.getByLabel('KerfDesk workspace', { exact: true }).focus();
  await page.keyboard.press('Control+a');
}

export async function recipeHistory(page: Page, redo: boolean): Promise<void> {
  await page.getByLabel('KerfDesk workspace', { exact: true }).focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}

export async function selectRecipeTarget(page: Page, index: number): Promise<void> {
  await recipePanelView(page, 'Run order');
  await recipeArtworkPanel(page)
    .getByRole('article')
    .nth(index)
    .getByRole('button', { name: /^Select / })
    .click();
  await recipePanelView(page, 'Settings');
}

export async function saveRecipeAcceptanceProject(
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
  if (text === undefined) throw new Error('Recipe acceptance project was not saved');
  return text;
}
