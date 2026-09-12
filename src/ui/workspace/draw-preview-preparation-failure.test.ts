import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { buildPreviewToolpath, buildPreviewToolpathUnbounded } from './draw-preview';
import { previewRouteSource } from './executable-plan-preview-route';
import { previewIssueFor } from './preview-status';

describe('preview preparation failures', () => {
  it('preserves the selected-output failure message instead of returning a generic empty job', () => {
    const toolpath = buildPreviewToolpath(createProject(), {
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: [],
      },
    });

    expect(previewIssueFor(toolpath)).toEqual({
      kind: 'preparation-failed',
      messages: [
        'Selected artwork only is enabled, but no artwork is selected. Select artwork or turn off Selected artwork only.',
      ],
    });
  });

  it('defers a large embedded raster on the UI thread', () => {
    const pending = buildPreviewToolpath(hugeRasterProject());

    expect(previewIssueFor(pending)).toEqual({ kind: 'too-complex' });
    expect(pending.steps).toEqual([]);
  });

  it('prepares the full 3000x3000 raster route without the UI scheduling gate (ADR-243/244)', () => {
    // Before ADR-243 this raster was refused for its ~78 MB materialized
    // working set. Workers/tests use the unbounded builder; the live UI now
    // routes even smaller rasters to background preparation.
    const toolpath = buildPreviewToolpathUnbounded(hugeRasterProject());

    expect(previewIssueFor(toolpath)).toBeNull();
    expect(previewRouteSource(toolpath)).toBe('legacy-toolpath');
    const cuts = toolpath.steps.filter((step) => step.kind === 'cut');
    expect(cuts).toHaveLength(3000);
    expect(cuts.reduce((length, step) => length + step.length, 0)).toBe(900_000);
    expect(new Set(cuts.map((step) => step.source?.rowIndex)).size).toBe(3000);
    expect(
      cuts.every((step) => step.source?.pixelStartX === 0 && step.source.pixelEndX === 2999),
    ).toBe(true);
  });

  it('defers page-backed raster preview to asynchronous worker preparation', () => {
    const project = hugeRasterProject();
    const raster = project.scene.objects[0];
    if (raster?.kind !== 'raster-image') throw new Error('missing raster');
    const { dataUrl: _dataUrl, ...pageFields } = raster;
    const toolpath = buildPreviewToolpath({
      ...project,
      scene: {
        ...project.scene,
        objects: [
          {
            ...pageFields,
            imageAsset: {
              schemaVersion: 1,
              repository: 'curvedesk-import-assets-v1',
              sourceAssetId: 'source-pages',
              lumaAssetId: 'luma-pages',
              sourceMimeType: 'image/png',
              sourceByteLength: 300_000_000,
              lumaByteLength: 16,
              naturalWidth: 4,
              naturalHeight: 4,
              sampledWidth: 4,
              sampledHeight: 4,
              thumbnail: {
                mimeType: 'image/bmp',
                dataUrl: 'data:image/bmp;base64,thumbnail',
                width: 4,
                height: 4,
              },
            },
          },
        ],
      },
    });

    expect(previewIssueFor(toolpath)).toEqual({ kind: 'too-complex' });
  });
});

function hugeRasterProject(): Project {
  const color = '#808080';
  const raster: SceneObject = {
    kind: 'raster-image',
    id: 'large-raster',
    color,
    source: 'large.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
  };
  const project = createProject();
  return {
    ...project,
    scene: addLayer(addObject(project.scene, raster), {
      ...createLayer({ id: color, color, mode: 'image' }),
      linesPerMm: 10,
    }),
  };
}
