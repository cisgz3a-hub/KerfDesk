import { describe, expect, it } from 'vitest';
import type { Project } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { assetReader, pagedProject } from '../library/personal-artwork-test-fixtures';
import { collectPagedRasterAssetIds } from '../import/paged-raster-asset-lifecycle';
import { portableProjectAssets } from './portable-project-assets';
import { projectSaveNeedsWorker } from './project-save-size';

function arrayProject(): Project {
  const source = pagedProject();
  const ids = source.scene.objects.map((object) => object.id);
  return {
    ...source,
    arrayLayouts: [
      {
        id: 'layout',
        name: 'Sample grid',
        spec: {
          kind: 'grid',
          rows: 1,
          columns: 1,
          spacingX: 0,
          spacingY: 0,
        },
        sourceIds: ids,
        instances: [
          { id: 'instance', sourceToObject: Object.fromEntries(ids.map((id) => [id, id])) },
        ],
        ownedObjectIds: ids,
        sourceProjectJson: serializeProject(source),
        baselineProjectJson: serializeProject(source),
      },
    ],
  };
}

describe('portable retained array source and baseline assets', () => {
  it('embeds source and baseline pixels/fonts while retaining layout ownership metadata', async () => {
    const source = arrayProject();
    const portable = await portableProjectAssets(source, assetReader());
    const layout = portable.arrayLayouts![0]!;
    for (const json of [layout.sourceProjectJson, layout.baselineProjectJson]) {
      const parsed = deserializeProject(json);
      expect(parsed.kind).toBe('ok');
      if (parsed.kind !== 'ok') throw new Error('array archive failed');
      expect(
        parsed.project.scene.objects.find((object) => object.kind === 'raster-image'),
      ).toMatchObject({
        dataUrl: 'data:image/png;base64,AQIDBA==',
        lumaBase64: 'AECA/w==',
      });
      expect(
        parsed.project.scene.objects.find((object) => object.kind === 'raster-image'),
      ).not.toHaveProperty('imageAsset');
      expect(parsed.project.embeddedFonts).toEqual(pagedProject().embeddedFonts);
    }
    expect(layout).toMatchObject({
      id: 'layout',
      instances: source.arrayLayouts![0]!.instances,
      ownedObjectIds: source.arrayLayouts![0]!.ownedObjectIds,
    });
    expect(projectSaveNeedsWorker(source)).toBe(true);
  });

  it('retains array-only source references with no image in the active scene', () => {
    const source = arrayProject();
    const blank = { ...source, scene: { ...source.scene, objects: [] } };
    expect(
      [
        ...collectPagedRasterAssetIds({
          project: blank,
          undoStack: [],
          redoStack: [],
          pendingUndo: null,
          sceneClipboard: null,
        }),
      ].sort(),
    ).toEqual(['luma', 'source']);
  });
});
