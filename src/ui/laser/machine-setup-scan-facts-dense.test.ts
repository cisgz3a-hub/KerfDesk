import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { bytesToBase64 } from '../import/base64-bytes';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';
import { buildMachineSetupScanFacts } from './machine-setup-scan-facts';

describe('buildMachineSetupScanFacts dense accepted raster', () => {
  it('computes actual split-runway minima incrementally without an argument overflow', () => {
    const width = 1024;
    const height = 1024;
    const luma = new Uint8Array(width * height).fill(255);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 16) luma[y * width + x] = 0;
    }
    const raster: RasterImage = {
      kind: 'raster-image',
      id: 'dense-split-raster',
      source: 'dense-split-raster.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      pixelWidth: width,
      pixelHeight: height,
      bounds: { minX: 0, minY: 0, maxX: 400, maxY: 400 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'threshold',
      linesPerMm: 1,
      lumaBase64: bytesToBase64(luma),
    };
    const project = createProject({ ...DEFAULT_DEVICE_PROFILE, maxFeed: 24000 });
    const serialized = serializeProject({
      ...project,
      scene: {
        ...project.scene,
        layers: [
          {
            ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
            speed: 6000,
            imageBidirectional: true,
            passThrough: true,
          },
        ],
        objects: [raster],
      },
    });
    const reloaded = deserializeProject(serialized);
    if (reloaded.kind !== 'ok') throw new Error(`dense fixture rejected: ${reloaded.kind}`);

    expect(costlyCanvasPreparation(reloaded.project)).toBe(false);
    expect(buildMachineSetupScanFacts(reloaded.project).lowOverscanGroups).toBe(1);
  });
});
