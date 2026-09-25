import type { Project } from '../../src/core/scene';
import type { PersonalArtwork } from '../../src/ui/library/personal-artwork-model';
import { expect, type KerfDeskFixture, type Page } from './kerfdesk-test';
import { applicationHeader, toolbarCommand } from './workspace-ui';
import { captureSvgCanvas } from './composed-svg-canvas';

export async function librarySnapshot(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ path)) as {
      useStore: {
        getState: () => {
          project: Project;
          undoStack: readonly unknown[];
          redoStack: readonly unknown[];
          dirty: boolean;
          savedName: string | null;
        };
      };
    };
    const state = useStore.getState();
    return {
      project: state.project,
      undoCount: state.undoStack.length,
      redoCount: state.redoStack.length,
      dirty: state.dirty,
      savedName: state.savedName,
    };
  });
}

export async function libraryRecords(page: Page): Promise<readonly PersonalArtwork[]> {
  return page.evaluate(
    () =>
      new Promise<readonly PersonalArtwork[]>((resolve, reject) => {
        const request = indexedDB.open('kerfdesk-personal-artwork-v1', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('artwork', 'readonly');
          const entries = tx.objectStore('artwork').getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(entries.result as PersonalArtwork[]);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

export async function menuAction(page: Page, menu: 'File' | 'Edit', item: string): Promise<void> {
  await page.getByRole('menuitem', { name: menu, exact: true }).click();
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('menuitem', { name: new RegExp(`^${escaped}(?:\\s|$)`) }).click();
}

export async function libraryNewProject(page: Page): Promise<void> {
  const dirty = (await librarySnapshot(page)).dirty;
  await menuAction(page, 'File', 'New');
  if (dirty) await page.getByRole('button', { name: "Don't Save", exact: true }).click();
  await expect.poll(async () => (await librarySnapshot(page)).project.scene.objects.length).toBe(0);
}

export async function openMyArtwork(page: Page) {
  await page.getByRole('button', { name: 'Open design library', exact: true }).click();
  await page.getByRole('button', { name: 'My artwork', exact: true }).click();
  const panel = page.getByRole('region', { name: 'My artwork', exact: true });
  await expect(panel.getByRole('button', { name: 'Import library...', exact: true })).toBeEnabled();
  return panel;
}

export async function libraryHistory(page: Page, action: 'Undo' | 'Redo'): Promise<void> {
  await page
    .getByRole('group', { name: 'Edit history', exact: true })
    .getByRole('button', { name: action, exact: true })
    .click();
}

export async function setLibraryOperation(page: Page, name: string, value: string): Promise<void> {
  const control = page.getByRole('spinbutton', { name: new RegExp(`^${name} for`) }).first();
  await control.fill(value);
  await control.press('Tab');
  await expect(control).toHaveValue(value);
}

export async function createLibraryMixedGroup(
  page: Page,
  fixture: KerfDeskFixture,
): Promise<Project> {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(applicationHeader(page)).toContainText('KerfDesk');
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 190, y: 180 } });
  await page.getByRole('textbox', { name: 'Text content on canvas' }).fill('Library badge');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await librarySnapshot(page)).project.scene.objects.length).toBe(1);
  await setLibraryOperation(page, 'Power', '37');
  await setLibraryOperation(page, 'Speed', '1234');
  await setLibraryOperation(page, 'Passes', '3');
  await fixture.setOpenFiles([
    { name: 'library-pixels.png', kind: 'png-fixture', width: 160, height: 80 },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect.poll(async () => (await librarySnapshot(page)).project.scene.objects.length).toBe(2);
  await setLibraryOperation(page, 'Power', '23');
  await setLibraryOperation(page, 'Speed', '765');
  await setLibraryOperation(page, 'Passes', '2');
  await menuAction(page, 'Edit', 'Select All');
  await menuAction(page, 'Edit', 'Group');
  await expect.poll(async () => (await librarySnapshot(page)).project.scene.groups?.length).toBe(1);
  const source = (await librarySnapshot(page)).project;
  expect(source.scene.objects.map((object) => object.kind)).toEqual(['text', 'raster-image']);
  expect(source.scene.layers.map(({ power, speed, passes }) => ({ power, speed, passes }))).toEqual(
    [
      { power: 37, speed: 1234, passes: 3 },
      { power: 23, speed: 765, passes: 2 },
    ],
  );
  return source;
}

export async function captureLibrarySave(
  fixture: KerfDeskFixture,
  action: () => Promise<void>,
): Promise<{ name: string; text: string }> {
  const count = (await fixture.events()).filter((event) => event.kind === 'file-saved').length;
  await action();
  await expect
    .poll(
      async () => (await fixture.events()).filter((event) => event.kind === 'file-saved').length,
    )
    .toBe(count + 1);
  const saved = (await fixture.events()).filter((event) => event.kind === 'file-saved').at(-1);
  const name = String(saved?.['name']);
  const text = (await fixture.savedFiles())[name];
  if (text === undefined) throw new Error('No saved file content');
  return { name, text };
}

export function expectLibraryCopy(actual: Project, source: Project): void {
  const objects = (project: Project) =>
    project.scene.objects.map((object) => ({ ...object, id: undefined, operationIds: undefined }));
  const operations = (project: Project) =>
    project.scene.layers.map((operation) => ({ ...operation, id: undefined }));
  expect(objects(actual)).toEqual(objects(source));
  expect(operations(actual)).toEqual(operations(source));
  expect(actual.scene.groups).toHaveLength(1);
  expect(actual.scene.groups?.[0]?.objectIds).toEqual(actual.scene.objects.map(({ id }) => id));
  expect(
    actual.scene.objects.every((object) =>
      object.operationIds?.every((id) => actual.scene.layers.some((layer) => layer.id === id)),
    ),
  ).toBe(true);
  expect(
    actual.scene.objects
      .map(({ id }) => id)
      .some((id) => source.scene.objects.some((object) => object.id === id)),
  ).toBe(false);
  // Operation IDs are allocated within a document and can repeat in a new one.
  // Independence is checked by editing and inserting a second copy in the test.
  expect(new Set(actual.scene.layers.map(({ id }) => id)).size).toBe(actual.scene.layers.length);
}

/** Sample the real painted canvas, independently of saved raster bytes. */
export async function libraryPaintedPixels(page: Page) {
  const { project } = await librarySnapshot(page);
  const raster = project.scene.objects.find((object) => object.kind === 'raster-image');
  if (raster?.kind !== 'raster-image') throw new Error('Library bitmap missing');
  const viewport = await captureSvgCanvas(page, project);
  return page.evaluate(
    ({ raster, viewport }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[aria-label="KerfDesk workspace"]',
      );
      const ctx = canvas?.getContext('2d');
      if (ctx == null) throw new Error('Workspace canvas unavailable');
      const { bounds: b, transform: t } = raster;
      const angle = (t.rotationDeg * Math.PI) / 180;
      return [0.5, 0.1].map((ratio) => {
        const x = (b.minX + (b.maxX - b.minX) * ratio) * t.scaleX * (t.mirrorX ? -1 : 1);
        const y = (b.minY + (b.maxY - b.minY) * ratio) * t.scaleY * (t.mirrorY ? -1 : 1);
        const px = Math.floor(
          viewport.offsetX + (t.x + x * Math.cos(angle) - y * Math.sin(angle)) * viewport.scale,
        );
        const py = Math.floor(
          viewport.offsetY + (t.y + x * Math.sin(angle) + y * Math.cos(angle)) * viewport.scale,
        );
        return [...ctx.getImageData(px, py, 1, 1).data];
      });
    },
    { raster, viewport },
  );
}

export async function editLibraryText(page: Page, content: string): Promise<void> {
  const { project } = await librarySnapshot(page);
  const text = project.scene.objects.find((object) => object.kind === 'text');
  if (text?.kind !== 'text') throw new Error('Editable library text missing');
  const viewport = await captureSvgCanvas(page, project);
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  const rect = await canvas.boundingBox();
  if (rect === null) throw new Error('Workspace bounds unavailable');
  await canvas.dblclick({
    position: {
      x:
        ((viewport.offsetX + (text.transform.x + 4) * viewport.scale) * rect.width) /
        viewport.width,
      y:
        ((viewport.offsetY + (text.transform.y + 4) * viewport.scale) * rect.height) /
        viewport.height,
    },
  });
  const input = page.getByRole('textbox', { name: 'Text content on canvas' });
  await expect(input).toHaveValue(text.content);
  await input.fill(content);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(input).toHaveCount(0);
}
