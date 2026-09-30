import { beforeEach, expect, it, vi } from 'vitest';
import { serializeProject } from '../../io/project';
import { assetReader, pagedProject } from '../library/personal-artwork-test-fixtures';
import { preserveBrowserProProject, usePendingProProjectStore } from '../state/pending-pro-project';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { portableProjectAssets } from './portable-project-assets';
import { savePreservedProProjectCopy } from './preserved-pro-project-copy';
import { proProject, reliefProject } from './pro-project-test-fixtures';

vi.mock('../../platform/build-capabilities', () => ({ BROWSER_FREE_BUILD: true }));

beforeEach(() => {
  resetStore();
  usePendingProProjectStore.setState({ pending: null });
});

it('saves a complete portable copy with all operations, fonts, groups, images and relief geometry', async () => {
  const paged = pagedProject();
  const relief = reliefProject().scene.objects.find((object) => object.kind === 'relief');
  if (relief === undefined) throw new Error('Missing fixture relief');
  const project = {
    ...proProject(),
    scene: { ...proProject().scene, objects: [...paged.scene.objects, relief] },
  };
  const pending = preserveBrowserProProject(project, { source: 'file', name: 'design.lf2' });
  if (pending === null) throw new Error('Expected desktop project');
  const current = useStore.getState();
  const write = vi.fn(async (_content: string | Blob) => undefined);
  const pickFileForSave = vi.fn(async () => ({ displayName: 'copy.lf2', write }));
  expect(await savePreservedProProjectCopy(pending, { pickFileForSave }, assetReader())).toBe(
    'saved',
  );
  expect(pickFileForSave).toHaveBeenCalledWith({
    suggestedName: 'design-preserved.lf2',
    extensions: ['.lf2'],
  });
  expect(write).toHaveBeenCalledExactlyOnceWith(
    serializeProject(await portableProjectAssets(project, assetReader())),
  );
  expect(useStore.getState()).toBe(current);
  expect(usePendingProProjectStore.getState().pending?.project).toBe(project);
  expect(project.scene.objects.find((object) => object.kind === 'raster-image')).toHaveProperty(
    'imageAsset',
  );
});

it('a cancelled copy leaves the preserved autosave and current file identity untouched', async () => {
  const pending = preserveBrowserProProject(proProject(), { source: 'autosave', name: null });
  if (pending === null) throw new Error('Expected desktop project');
  const originalTarget = { displayName: 'working.lf2', write: vi.fn() };
  useStore.setState({
    savedName: originalTarget.displayName,
    lastSaveTarget: originalTarget,
    dirty: true,
  });
  const current = useStore.getState();
  const reader = assetReader();
  const read = vi.spyOn(reader, 'readManifest');
  expect(
    await savePreservedProProjectCopy(pending, { pickFileForSave: async () => null }, reader),
  ).toBe('cancelled');
  expect(read).not.toHaveBeenCalled();
  expect(originalTarget.write).not.toHaveBeenCalled();
  expect(useStore.getState()).toBe(current);
  expect(usePendingProProjectStore.getState().pending).toBe(pending);
});

it('failed image hydration writes nothing and retains the complete original for another attempt', async () => {
  const base = proProject();
  const project = { ...base, scene: { ...base.scene, objects: pagedProject().scene.objects } };
  const pending = preserveBrowserProProject(project);
  if (pending === null) throw new Error('Expected desktop project');
  const write = vi.fn(async () => undefined);
  const reader = { ...assetReader(), readManifest: async () => null };
  await expect(
    savePreservedProProjectCopy(
      pending,
      {
        pickFileForSave: async () => ({ displayName: 'copy.lf2', write }),
      },
      reader,
    ),
  ).rejects.toThrow('unavailable');
  expect(write).not.toHaveBeenCalled();
  expect(usePendingProProjectStore.getState().pending?.project).toBe(project);
});
