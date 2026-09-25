import { writeFile } from 'node:fs/promises';
import type { Project } from '../src/core/scene';
import {
  captureLibrarySave,
  createLibraryMixedGroup,
  editLibraryText,
  expectLibraryCopy,
  libraryNewProject,
  libraryRecords,
  libraryHistory,
  librarySnapshot,
  libraryPaintedPixels,
  menuAction,
  openMyArtwork,
  setLibraryOperation,
} from './fixtures/artwork-library-acceptance';
import { expect, test } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

test('My artwork persists mixed groups and exchanges portable independent editable copies', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(150_000);
  const source = await createLibraryMixedGroup(page, kerfdesk);
  let panel = await openMyArtwork(page);
  await panel.getByRole('textbox', { name: 'Name', exact: true }).fill('Workshop badge');
  await panel.getByRole('combobox', { name: 'Category', exact: true }).fill('Acceptance jigs');
  await panel.getByRole('button', { name: 'Save selection to My artwork', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Insert artwork', exact: true })).toBeEnabled();
  const [savedEntry] = await libraryRecords(page);
  expect(savedEntry).toMatchObject({ name: 'Workshop badge', category: 'Acceptance jigs' });
  if (savedEntry === undefined) throw new Error('Library did not persist the selection');
  const savedProject = JSON.parse(savedEntry.projectJson) as Project;
  expect(savedProject.scene).toEqual(source.scene);
  const image = savedProject.scene.objects.find((object) => object.kind === 'raster-image');
  expect(image?.kind === 'raster-image' && image.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(image?.kind === 'raster-image' && image.imageAsset).toBeUndefined();
  await page.getByRole('button', { name: 'Close Design Library', exact: true }).click();
  await libraryNewProject(page);
  await page.reload();
  panel = await openMyArtwork(page);
  await panel
    .getByRole('searchbox', { name: 'Search my artwork', exact: true })
    .fill('missing entry');
  await expect(
    panel.getByText('No saved artwork matches this view.', { exact: true }),
  ).toBeVisible();
  await panel.getByRole('searchbox', { name: 'Search my artwork', exact: true }).fill('Workshop');
  await panel
    .getByRole('combobox', { name: 'Show category', exact: true })
    .selectOption('Acceptance jigs');
  await expect(
    panel.getByRole('button', { name: 'Workshop badge Acceptance jigs', exact: true }),
  ).toBeVisible();
  expect(await libraryRecords(page)).toEqual([savedEntry]);
  await page.screenshot({ path: info.outputPath('library-reopened.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Insert artwork', exact: true }).click();
  let inserted = await librarySnapshot(page);
  expectLibraryCopy(inserted.project, source);
  expect(inserted.undoCount).toBe(1);
  await libraryHistory(page, 'Undo');
  await expect.poll(async () => (await librarySnapshot(page)).project.scene.objects.length).toBe(0);
  await libraryHistory(page, 'Redo');
  await expect.poll(async () => (await librarySnapshot(page)).project).toEqual(inserted.project);
  await setLibraryOperation(page, 'Power', '17');
  const changed = (await librarySnapshot(page)).project;
  expect(changed.scene.layers[0]?.power).toBe(17);
  panel = await openMyArtwork(page);
  await panel.getByRole('button', { name: 'Insert artwork', exact: true }).click();
  inserted = await librarySnapshot(page);
  expect(inserted.project.scene.objects).toHaveLength(4);
  expect(inserted.project.scene.groups).toHaveLength(2);
  expect(new Set(inserted.project.scene.layers.map(({ id }) => id)).size).toBe(4);
  expect(inserted.project.scene.layers.map(({ power }) => power)).toEqual([17, 23, 37, 23]);
  const firstIds = new Set(
    inserted.project.scene.objects.slice(0, 2).flatMap((object) => object.operationIds ?? []),
  );
  expect(
    inserted.project.scene.objects
      .slice(2)
      .every((object) => object.operationIds?.every((id) => !firstIds.has(id))),
  ).toBe(true);
  expect(await libraryRecords(page)).toEqual([savedEntry]);
  await libraryHistory(page, 'Undo');
  await expect.poll(async () => (await librarySnapshot(page)).project).toEqual(changed);
  await libraryHistory(page, 'Redo');
  await expect.poll(async () => (await librarySnapshot(page)).project).toEqual(inserted.project);
  panel = await openMyArtwork(page);
  const exchange = await captureLibrarySave(kerfdesk, () =>
    panel.getByRole('button', { name: 'Export library...', exact: true }).click(),
  );
  expect(exchange.name).toBe('my-artwork.lfart');
  expect(JSON.parse(exchange.text)).toMatchObject({
    format: 'kerfdesk-artwork-library',
    version: 1,
    entries: [savedEntry],
  });
  await panel.getByRole('button', { name: 'Delete from My artwork', exact: true }).click();
  await expect(
    panel.getByText('No saved artwork matches this view.', { exact: true }),
  ).toBeVisible();
  expect(await libraryRecords(page)).toEqual([]);
  await kerfdesk.setOpenFiles([{ name: 'exchanged.lfart', text: exchange.text }]);
  await panel.getByRole('button', { name: 'Import library...', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Insert artwork', exact: true })).toBeEnabled();
  const [exchanged] = await libraryRecords(page);
  expect(exchanged).toMatchObject({
    name: savedEntry.name,
    category: savedEntry.category,
    projectJson: savedEntry.projectJson,
    selectedObjectIds: savedEntry.selectedObjectIds,
  });
  expect(exchanged?.id).not.toBe(savedEntry.id);
  await page.getByRole('button', { name: 'Close Design Library', exact: true }).click();
  await libraryNewProject(page);
  panel = await openMyArtwork(page);
  await panel.getByRole('button', { name: 'Insert artwork', exact: true }).click();
  expectLibraryCopy((await librarySnapshot(page)).project, source);
  await menuAction(page, 'Edit', 'Clear Selection');
  const expectedPixels = [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ];
  await expect.poll(() => libraryPaintedPixels(page)).toEqual(expectedPixels);
  const beforeTextEdit = (await librarySnapshot(page)).project;
  await editLibraryText(page, 'Custom badge');
  await expect
    .poll(async () => (await librarySnapshot(page)).project.scene.objects[0])
    .toMatchObject({ kind: 'text', content: 'Custom badge' });
  const editedText = (await librarySnapshot(page)).project.scene.objects[0];
  expect(await libraryRecords(page)).toEqual([exchanged]);
  await libraryHistory(page, 'Undo');
  await expect.poll(async () => (await librarySnapshot(page)).project).toEqual(beforeTextEdit);
  await page.screenshot({
    path: info.outputPath('library-exchanged-insertion.png'),
    fullPage: true,
  });
  await writeFile(info.outputPath('exchanged.lfart'), exchange.text);
  await writeFile(
    info.outputPath('library-evidence.json'),
    JSON.stringify(
      {
        source,
        savedEntry,
        exchanged,
        editedText,
        final: await librarySnapshot(page),
        events: await kerfdesk.events(),
        paintedPixels: await libraryPaintedPixels(page),
      },
      null,
      2,
    ),
  );
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial'))).toEqual([]);
});

test('protected template opens as a dirty new project and first Save preserves the master', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(120_000);
  const source = await createLibraryMixedGroup(page, kerfdesk);
  const master = await captureLibrarySave(kerfdesk, () =>
    menuAction(page, 'File', 'Save template...'),
  );
  expect(master.name).toBe('untitled.lf2template');
  const envelope = JSON.parse(master.text) as {
    format: string;
    version: number;
    projectJson: string;
  };
  expect(envelope).toMatchObject({ format: 'kerfdesk-project-template', version: 1 });
  expect((JSON.parse(envelope.projectJson) as Project).scene).toEqual(source.scene);
  await libraryNewProject(page);
  await kerfdesk.setOpenFiles([{ name: master.name, text: master.text }]);
  await menuAction(page, 'File', 'Open template...');
  await expect.poll(async () => (await librarySnapshot(page)).project.scene).toEqual(source.scene);
  const opened = await librarySnapshot(page);
  expect(opened).toMatchObject({
    dirty: true,
    savedName: 'untitled.lf2',
    undoCount: 0,
    redoCount: 0,
  });
  const pickersBefore = (await kerfdesk.events()).filter(
    (event) => event.kind === 'picker-save',
  ).length;
  const firstSave = await captureLibrarySave(kerfdesk, async () =>
    (await toolbarCommand(page, 'Save')).click(),
  );
  expect(firstSave.name).toBe('untitled.lf2');
  const events = await kerfdesk.events();
  expect(events.filter((event) => event.kind === 'picker-save')).toHaveLength(pickersBefore + 1);
  expect(JSON.parse(firstSave.text).scene).toEqual(source.scene);
  expect((await kerfdesk.savedFiles())[master.name]).toBe(master.text);
  expect(
    events.filter((event) => event.kind === 'file-saved' && event['name'] === master.name),
  ).toHaveLength(1);
  expect((await librarySnapshot(page)).dirty).toBe(false);
  await libraryNewProject(page);
  await kerfdesk.setOpenFiles([{ name: firstSave.name, text: firstSave.text }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect.poll(async () => (await librarySnapshot(page)).project.scene).toEqual(source.scene);
  expect((await librarySnapshot(page)).dirty).toBe(false);
  await expect
    .poll(() => libraryPaintedPixels(page))
    .toEqual([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
  await page.screenshot({ path: info.outputPath('template-first-save.png'), fullPage: true });
  await writeFile(info.outputPath('protected-master.lf2template'), master.text);
  await writeFile(info.outputPath('first-save.lf2'), firstSave.text);
  await writeFile(
    info.outputPath('template-evidence.json'),
    JSON.stringify(
      { opened, firstSave, events, paintedPixels: await libraryPaintedPixels(page) },
      null,
      2,
    ),
  );
  expect(events.filter((event) => event.kind.startsWith('serial'))).toEqual([]);
});
