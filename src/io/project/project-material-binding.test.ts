import { describe, expect, it } from 'vitest';
import { createLayer, createProject, type LayerOperationSettings } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('linked material binding persistence', () => {
  it('round-trips the link and its last-resolved settings snapshot', () => {
    const layer = createLayer({ id: '#ff0000', color: '#ff0000' });
    const snapshot: LayerOperationSettings = {
      mode: layer.mode,
      minPower: layer.minPower,
      power: layer.power,
      speed: layer.speed,
      passes: layer.passes,
      airAssist: layer.airAssist,
      kerfOffsetMm: layer.kerfOffsetMm,
      tabsEnabled: layer.tabsEnabled,
      tabSizeMm: layer.tabSizeMm,
      tabsPerShape: layer.tabsPerShape,
      tabSkipInnerShapes: layer.tabSkipInnerShapes,
      hatchAngleDeg: layer.hatchAngleDeg,
      hatchSpacingMm: layer.hatchSpacingMm,
      fillOverscanMm: layer.fillOverscanMm,
      fillStyle: layer.fillStyle,
      fillBidirectional: layer.fillBidirectional,
      fillCrossHatch: layer.fillCrossHatch,
      ditherAlgorithm: layer.ditherAlgorithm,
      linesPerMm: layer.linesPerMm,
      imageBidirectional: layer.imageBidirectional,
      negativeImage: layer.negativeImage,
      passThrough: layer.passThrough,
      dotWidthCorrectionMm: layer.dotWidthCorrectionMm,
    };
    const project = {
      ...createProject(),
      scene: {
        objects: [],
        groups: [],
        layers: [
          {
            ...layer,
            materialBinding: {
              libraryId: 'shop-library',
              presetId: 'birch-cut',
              lastResolved: snapshot,
            },
          },
        ],
      },
    };
    const result = deserializeProject(serializeProject(project));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.scene.layers[0]?.materialBinding).toEqual(
        project.scene.layers[0]?.materialBinding,
      );
    }
  });
});
