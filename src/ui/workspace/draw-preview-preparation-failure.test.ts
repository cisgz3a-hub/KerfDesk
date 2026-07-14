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
import { buildPreviewToolpath } from './draw-preview';
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

  it('preserves raster budget failures beside the blank preview', () => {
    const toolpath = buildPreviewToolpath(hugeRasterProject());

    expect(previewIssueFor(toolpath)).toMatchObject({
      kind: 'preparation-failed',
      messages: [
        expect.stringMatching(
          /3000x3000 px \(~78 MB materialized working set exceeds the 64 MB budget\)/,
        ),
      ],
    });
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
    dither: 'floyd-steinberg',
    linesPerMm: 25,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
  };
  const project = createProject();
  return {
    ...project,
    scene: addLayer(
      addObject(project.scene, raster),
      createLayer({ id: color, color, mode: 'image' }),
    ),
  };
}
