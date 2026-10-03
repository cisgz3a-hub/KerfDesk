import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';
import type { AppState } from '../src/ui/state/store';

async function scene(page: Page) {
  return page.evaluate(async () => {
    const moduleUrl = '/src/ui/state/index.ts';
    const { useStore } = (await import(moduleUrl)) as {
      useStore: { getState: () => AppState };
    };
    const state = useStore.getState();
    return {
      objects: state.project.scene.objects,
      undo: state.undoStack.length,
      selection: state.selectedObjectId,
      additionalSelection: state.additionalSelectedIds,
    };
  });
}

async function canvasText(page: Page, content = 'Small audit café') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 180, y: 220 } });
  const input = page.getByRole('textbox', { name: 'Text content on canvas' });
  await input.fill(content);
  return input;
}

async function legacyTextDialog(page: Page) {
  await page.goto('/');
  // Mount the same production dialog retained by App; no fake dialog implementation.
  await page.evaluate(async () => {
    const moduleUrl = '/src/ui/state/ui-store.ts';
    const { useUiStore } = await import(moduleUrl);
    useUiStore.getState().openTextDialog({ mode: 'add' });
  });
  const dialog = page.getByRole('dialog', { name: 'Add or edit text', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('composition Escape retains a modal text draft until an ordinary Escape', async ({ page }) => {
  const dialog = await legacyTextDialog(page);
  const text = dialog.getByRole('textbox', { name: 'Text content', exact: true });
  await text.fill('Pending café');
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    await text.evaluate((element, init) => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    }, composition);
    await expect(dialog).toBeVisible();
    await expect(text).toHaveValue('Pending café');
  }
  expect((await scene(page)).objects).toHaveLength(0);
  await text.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await scene(page)).undo).toBe(0);
});

test('a busy conversion keeps Shift+Tab inside its remaining Cancel control', async ({
  page,
  kerfdesk,
}) => {
  await page.addInitScript(() => {
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        if (String(args[0]).includes('convert-bitmap-worker')) worker.postMessage = () => undefined;
        return worker;
      },
    });
  });
  await page.goto('/');
  await kerfdesk.setOpenFiles([
    {
      name: 'focus.svg',
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><path fill="#000" d="M0 0H10V10H0Z"/></svg>',
    },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await page.getByRole('button', { name: 'More commands', exact: true }).click();
  await page
    .getByRole('menu', { name: 'More commands', exact: true })
    .getByRole('menuitem', { name: 'Convert to Bitmap...', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Convert to Bitmap', exact: true });
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(dialog.getByRole('progressbar', { name: 'Converting to bitmap' })).toBeVisible();
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeFocused();
  await cancel.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await cancel.press('Tab');
  await expect(cancel).toBeFocused();
  await cancel.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect((await scene(page)).objects).toHaveLength(1);
});

test('font arrows and wheel browse without changing the draft and Enter selects only its font', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  const text = await canvasText(page);
  const trigger = page.getByRole('button', { name: 'Font', exact: true });
  const original = await trigger.textContent();
  await trigger.press('ArrowDown');
  const chooser = page.getByRole('dialog', { name: 'Choose a font', exact: true });
  const search = chooser.getByRole('searchbox', { name: 'Search fonts' });
  await expect(search).toBeFocused();
  const scroll = page.locator('.lf-canvas-text-scroll');
  const oldScroll = await scroll.evaluate((element) => element.scrollTop);
  await search.press('ArrowDown');
  const first = chooser.getByRole('option').first().locator('button');
  await expect(first).toBeFocused();
  await first.press('End');
  const last = chooser.getByRole('option').last().locator('button');
  await expect(last).toBeFocused();
  await last.hover();
  await page.mouse.wheel(0, 900);
  await expect(trigger).toHaveText(original ?? '');
  expect((await scene(page)).objects).toHaveLength(0);
  expect(await scroll.evaluate((element) => element.scrollTop)).toBe(oldScroll);
  await last.press('Enter');
  await expect(chooser).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect((await scene(page)).objects).toHaveLength(0);
  await expect(text).toHaveValue('Small audit café');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(text).toHaveCount(0);
  expect((await scene(page)).objects).toHaveLength(1);
  expect((await scene(page)).undo).toBe(1);
});

test('empty font results, native search deletion and Escape keep the surrounding text draft', async ({
  page,
}) => {
  const text = await canvasText(page, 'Unsaved lettering');
  const trigger = page.getByRole('button', { name: 'Font', exact: true });
  const original = await trigger.textContent();
  await trigger.click();
  const chooser = page.getByRole('dialog', { name: 'Choose a font', exact: true });
  const search = chooser.getByRole('searchbox', { name: 'Search fonts' });
  await search.fill('No such typeface 938471');
  await expect(chooser).toContainText('No fonts match your search.');
  await search.press('Enter');
  await expect(chooser).toBeVisible();
  await expect(trigger).toHaveText(original ?? '');
  await search.press('Control+a');
  await search.press('Backspace');
  await expect(search).toHaveValue('');
  await expect(chooser.getByRole('option')).toHaveCount(25);
  await search.press('Escape');
  await expect(chooser).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(text).toHaveValue('Unsaved lettering');
  expect((await scene(page)).objects).toHaveLength(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await scene(page)).undo).toBe(0);
});

test('a nested font popover consumes only the first Escape and restores its modal control', async ({
  page,
}) => {
  const dialog = await legacyTextDialog(page);
  const text = dialog.getByRole('textbox', { name: 'Text content', exact: true });
  await text.fill('Keep modal content');
  const trigger = dialog.getByRole('button', { name: 'Font', exact: true });
  await trigger.click();
  const chooser = page.getByRole('dialog', { name: 'Choose a font', exact: true });
  await chooser.getByRole('searchbox', { name: 'Search fonts' }).press('Escape');
  await expect(chooser).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(text).toHaveValue('Keep modal content');
  await trigger.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await scene(page)).objects).toHaveLength(0);
});

test('textarea native select, delete, undo and newline keep canvas history unchanged until Done', async ({
  page,
  kerfdesk,
}) => {
  const text = await canvasText(page, 'Original lettering');
  await text.press('Control+Enter');
  await expect(text).toHaveCount(0);
  const initial = await scene(page);
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .dblclick({ position: { x: 194, y: 226 } });
  await expect(text).toHaveValue('Original lettering');
  await text.press('Control+a');
  await text.press('Delete');
  await expect(text).toHaveValue('');
  await text.pressSequentially('New text');
  await text.press('Control+z');
  await expect(text).not.toHaveValue('New text');
  expect((await scene(page)).objects).toEqual(initial.objects);
  expect((await scene(page)).undo).toBe(initial.undo);
  await text.fill('Edited');
  await text.press('Enter');
  await text.pressSequentially('next line');
  await expect(text).toHaveValue('Edited\nnext line');
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toHaveLength(
    0,
  );
  await text.press('Escape');
  expect((await scene(page)).objects).toEqual(initial.objects);
  expect((await scene(page)).undo).toBe(initial.undo);
});

test('reopening an existing edit after Cancel uses saved content and a fresh caret', async ({
  page,
}) => {
  const text = await canvasText(page, 'Saved text');
  await text.press('Control+Enter');
  await expect(text).toHaveCount(0);
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  await canvas.dblclick({ position: { x: 194, y: 226 } });
  await text.fill('Discard this');
  await text.press('Escape');
  await canvas.dblclick({ position: { x: 194, y: 226 } });
  await expect(text).toHaveValue('Saved text');
  await expect(text).toBeFocused();
  expect(await text.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(10);
  await text.pressSequentially(' again');
  await text.press('Control+Enter');
  await expect(text).toHaveCount(0);
  expect((await scene(page)).objects[0]).toMatchObject({ content: 'Saved text again' });
  expect((await scene(page)).undo).toBe(2);
});
