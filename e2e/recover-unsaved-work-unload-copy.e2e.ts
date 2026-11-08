// Rolling audit v10 V7-P1-1 (ADR-688 Amendment 1): a tab that closes with
// unsaved work leaves its 30 s IndexedDB copy and a newer unload copy in
// localStorage. File > Recover unsaved work listed both as two sessions, and
// restoring the older one deleted the newer edits for good.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { waitForStartupSplash } from './fixtures/startup-splash';

test('a tab closed with unsaved work is recovered once, with its newest edits', async ({
  context,
}) => {
  test.setTimeout(240_000);
  const first = await openTab(context);
  await drawRectangles(first, 1);
  // The 30 s interval's IndexedDB copy, written now instead of waiting for the loop.
  expect(await intervalAutosave(first)).toMatchObject({ kind: 'ok', backend: 'indexeddb' });
  // Edits after the interval copy, which only the unload copy holds.
  await drawRectangles(first, 3);
  await closeLeavingSite(first);

  const second = await openTab(context);
  await second.getByRole('button', { name: 'Start fresh', exact: true }).click();
  const rows = await openRecoverUnsavedWork(second);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('3 objects');
  const closedSessionKey = await rows.first().getAttribute('data-unsaved-work');
  await rows.first().getByRole('button', { name: 'Restore', exact: true }).click();
  await expect.poll(() => objectCount(second)).toBe(3);
  // Restore re-homes the work into this tab's slot, then clears the closed
  // session's copies; the preparation worker can be slow on a cold dev server.
  await expect
    .poll(() => second.evaluate((key) => localStorage.getItem(key ?? ''), closedSessionKey), {
      timeout: 60_000,
    })
    .toBeNull();
  await closeLeavingSite(second);

  // The restored work is still the newest copy, listed once.
  const third = await openTab(context);
  await third.getByRole('button', { name: 'Start fresh', exact: true }).click();
  const remaining = await openRecoverUnsavedWork(third);
  await expect(remaining).toHaveCount(1);
  await expect(remaining.first()).toContainText('3 objects');
});

async function openTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await waitForStartupSplash(page);
  return page;
}

async function drawRectangles(page: Page, count: number): Promise<void> {
  await page.evaluate(async (total) => {
    const storePath = '/src/ui/state/store.ts';
    const scenePath = '/src/core/scene/index.ts';
    const shapePath = '/src/core/shapes/primitives/index.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storePath
    )) as typeof import('../src/ui/state/store');
    const { createProject, createLayer, IDENTITY_TRANSFORM } = (await import(
      /* @vite-ignore */ scenePath
    )) as typeof import('../src/core/scene');
    const { createRectangle } = (await import(
      /* @vite-ignore */ shapePath
    )) as typeof import('../src/core/shapes/primitives');
    const color = '#000000';
    const objects = Array.from({ length: total }, (_, index) =>
      createRectangle({
        id: `rect-${index}`,
        color,
        spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 10 + index * 30, y: 10 },
      }),
    );
    const project = createProject();
    useStore.getState().setProject({
      ...project,
      scene: {
        ...project.scene,
        objects,
        layers: [createLayer({ id: 'layer', color, mode: 'line' })],
      },
    });
    useStore.setState({ dirty: true });
  }, count);
}

async function intervalAutosave(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const autosavePath = '/src/ui/state/autosave-durable.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storePath
    )) as typeof import('../src/ui/state/store');
    const { projectAutosaveService } = (await import(
      /* @vite-ignore */ autosavePath
    )) as typeof import('../src/ui/state/autosave-durable');
    return projectAutosaveService.write(useStore.getState().project);
  });
}

async function closeLeavingSite(page: Page): Promise<void> {
  // The unsaved-changes guard asks before the tab closes; Leave.
  page.on('dialog', (dialog) => void dialog.accept());
  const closed = page.waitForEvent('close');
  await page.close({ runBeforeUnload: true });
  await closed;
}

async function openRecoverUnsavedWork(page: Page) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Recover unsaved work/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved work', exact: true });
  await expect(dialog.getByRole('list')).toBeVisible();
  return dialog.getByRole('listitem');
}

async function objectCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const { useStore } = (await import(
      /* @vite-ignore */ storePath
    )) as typeof import('../src/ui/state/store');
    return useStore.getState().project.scene.objects.length;
  });
}
