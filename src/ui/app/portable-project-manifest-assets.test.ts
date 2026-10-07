import { describe, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { projectSaveNeedsWorker } from './project-save-size';
import { assetReader, pagedProject } from '../library/personal-artwork-test-fixtures';
import {
  collectPagedRasterAssetIds,
  PagedRasterAssetLifecycle,
} from '../import/paged-raster-asset-lifecycle';
import {
  projectAssetArchiveBudget,
  readProjectAssetArchive,
  type ProjectAssetArchive,
} from '../import/project-asset-archives';
import { captureLocalProjectSnapshot } from '../recent-projects/local-project-snapshot';
import { portableProjectAssets } from './portable-project-assets';

function manifestProject(): Project {
  const json = serializeProject(pagedProject());
  const time = '2026-10-07T00:00:00.000Z';
  return {
    ...createProject(),
    productionManifest: {
      id: 'run',
      name: 'Test run',
      frozenAt: time,
      designProjectJson: json,
      rows: [
        {
          id: 'row',
          index: 0,
          recordIndex: 0,
          serialValue: 1,
          values: [],
          status: 'reviewed',
          notes: 'Use sample',
          reviewedProjectJson: json,
          reviewedAt: time,
        },
      ],
    },
  };
}
function imageIn(json: string) {
  const parsed = deserializeProject(json);
  if (parsed.kind !== 'ok') throw new Error('archive did not reopen');
  return parsed.project.scene.objects.find((object) => object.kind === 'raster-image');
}

describe('portable production manifest archive assets', () => {
  it('embeds source/luma/font data for design and reviewed rows inside an inactive sheet', async () => {
    const source = {
      ...createProject(),
      sheetBook: {
        activeId: 'blank',
        activeName: 'Blank',
        inactive: [{ id: 'run', name: 'Run', projectJson: serializeProject(manifestProject()) }],
      },
    };
    const copy = await captureLocalProjectSnapshot(source, 'Resume run', assetReader());
    const book = deserializeProject(copy.projectJson);
    expect(book.kind).toBe('ok');
    if (book.kind !== 'ok') throw new Error('book did not reopen');
    const sheet = deserializeProject(book.project.sheetBook!.inactive[0]!.projectJson);
    expect(sheet.kind).toBe('ok');
    if (sheet.kind !== 'ok') throw new Error('sheet did not reopen');
    const manifest = sheet.project.productionManifest!;
    for (const json of [manifest.designProjectJson, manifest.rows[0]!.reviewedProjectJson!]) {
      expect(imageIn(json)).toMatchObject({
        dataUrl: 'data:image/png;base64,AQIDBA==',
        lumaBase64: 'AECA/w==',
      });
      expect(imageIn(json)).not.toHaveProperty('imageAsset');
      const parsed = deserializeProject(json);
      if (parsed.kind !== 'ok') throw new Error('copy failed');
      expect(parsed.project.embeddedFonts).toEqual(pagedProject().embeddedFonts);
    }
    expect(manifest.rows[0]).toMatchObject({ status: 'reviewed', notes: 'Use sample' });
    expect(projectSaveNeedsWorker(manifestProject())).toBe(true);
  });

  it('retains manifest-only image references and reuses immutable archive identity caches', async () => {
    const blank = createProject();
    const project = manifestProject();
    const state = (artwork: Project) => ({
      project: artwork,
      undoStack: [],
      redoStack: [],
      pendingUndo: null,
      sceneClipboard: null,
    });
    const repository = { cancelDelete: vi.fn(async () => undefined) };
    const lifecycle = new PagedRasterAssetLifecycle(repository);
    await lifecycle.transition(state(blank), state(project));
    expect(repository.cancelDelete.mock.calls).toEqual([['source'], ['luma']]);
    const parsing = vi.spyOn(JSON, 'parse');
    try {
      expect([...collectPagedRasterAssetIds(state(project))].sort()).toEqual(['luma', 'source']);
      expect(parsing).not.toHaveBeenCalled();
    } finally {
      parsing.mockRestore();
    }
  });

  it('rejects archive budget exhaustion and recursive workflow documents without mutating the input', async () => {
    const entry: ProjectAssetArchive = {
      owner: {},
      key: 'designProjectJson',
      label: 'Design',
      kind: 'production',
      json: '{"productionManifest":{}}',
    };
    expect(() =>
      readProjectAssetArchive(entry, { remainingChars: 4, remainingEntries: 1 }),
    ).toThrow('copy budget');
    expect(() => readProjectAssetArchive(entry, projectAssetArchiveBudget())).toThrow(
      'Recursive production',
    );
    const project = manifestProject();
    const before = JSON.stringify(project);
    await portableProjectAssets(project, assetReader());
    expect(JSON.stringify(project)).toBe(before);
  });
});
