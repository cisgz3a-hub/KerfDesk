import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { buildMachineSetupScanFacts } from './machine-setup-scan-facts';

describe('buildMachineSetupScanFacts', () => {
  it('counts output even when canvas visibility is off and reports profile-forced one-way groups', () => {
    const project = fillProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, {
      visible: false,
      fillBidirectional: true,
    });

    expect(buildMachineSetupScanFacts(project)).toMatchObject({
      requestedFillOperations: 1,
      requestedBidirectionalOperations: 1,
      executableScanGroups: 1,
      effectiveBidirectionalGroups: 0,
      profileFallbackGroups: 1,
      lowOverscanGroups: 0,
    });
  });

  it('uses object-effective direction and compiled runway instead of raw layer intent', () => {
    const project = fillProject(DEFAULT_DEVICE_PROFILE, {
      fillBidirectional: false,
      fillOverscanMm: 0,
    });
    const object = project.scene.objects[0];
    if (object === undefined) throw new Error('fixture object missing');
    const withOverride: Project = {
      ...project,
      scene: {
        ...project.scene,
        objects: [
          {
            ...object,
            operationOverride: { mode: 'fill', fillStyle: 'scanline', fillBidirectional: true },
          },
        ],
      },
    };

    expect(buildMachineSetupScanFacts(withOverride)).toMatchObject({
      requestedBidirectionalOperations: 0,
      executableScanGroups: 1,
      effectiveBidirectionalGroups: 1,
      profileFallbackGroups: 0,
      lowOverscanGroups: 0,
    });
  });

  it('compares runway with the emitted-speed 5 percent calibration reference', () => {
    const justBelow = fillProject(DEFAULT_DEVICE_PROFILE, {
      speed: 6000,
      fillBidirectional: true,
      fillOverscanMm: 4.9,
    });
    const atReference = fillProject(DEFAULT_DEVICE_PROFILE, {
      speed: 6000,
      fillBidirectional: true,
      fillOverscanMm: 5,
    });
    const slower = fillProject(DEFAULT_DEVICE_PROFILE, {
      speed: 1200,
      fillBidirectional: true,
      fillOverscanMm: 1,
    });

    expect(buildMachineSetupScanFacts(justBelow).lowOverscanGroups).toBe(1);
    expect(buildMachineSetupScanFacts(atReference).lowOverscanGroups).toBe(0);
    expect(buildMachineSetupScanFacts(slower).lowOverscanGroups).toBe(0);
  });

  it('flags split fill sweeps whose actual internal runways fall below the reference', () => {
    const project = fillProject(DEFAULT_DEVICE_PROFILE, {
      speed: 6000,
      fillBidirectional: true,
      fillOverscanMm: 5,
    });
    const object = project.scene.objects[0];
    if (object?.kind !== 'imported-svg') throw new Error('fill fixture object missing');
    const split: Project = {
      ...project,
      scene: {
        ...project.scene,
        objects: [
          {
            ...object,
            bounds: { minX: 20, minY: 20, maxX: 46, maxY: 40 },
            paths: [
              {
                color: '#ff0000',
                polylines: [rectangle(20, 30), rectangle(36, 46)],
              },
            ],
          },
        ],
      },
    };

    expect(buildMachineSetupScanFacts(split).lowOverscanGroups).toBe(1);
  });

  it('flags split raster sweeps whose emitted internal runway is shortened', () => {
    const project = createProject(DEFAULT_DEVICE_PROFILE);
    const raster: RasterImage = {
      kind: 'raster-image',
      id: 'split-raster',
      source: 'split-raster.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      pixelWidth: 8,
      pixelHeight: 1,
      bounds: { minX: 20, minY: 20, maxX: 28, maxY: 21 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'threshold',
      linesPerMm: 1,
      lumaBase64: 'AP///////wA=',
    };
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      speed: 6000,
      imageBidirectional: true,
      passThrough: true,
    };
    const withRaster: Project = {
      ...project,
      scene: { ...project.scene, layers: [layer], objects: [raster] },
    };

    expect(buildMachineSetupScanFacts(withRaster).lowOverscanGroups).toBe(1);
  });
});

function fillProject(
  device: typeof DEFAULT_DEVICE_PROFILE,
  patch: Partial<ReturnType<typeof createLayer>>,
): Project {
  const project = createProject(device);
  const color = '#ff0000';
  const layer = {
    ...createLayer({ id: 'fill', name: 'Fill', color }),
    mode: 'fill' as const,
    fillStyle: 'scanline' as const,
    hatchSpacingMm: 1,
    ...patch,
  };
  return {
    ...project,
    scene: { ...project.scene, layers: [layer], objects: [squareObject(color)] },
  };
}

function squareObject(color: string): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 20, minY: 20, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            points: [
              { x: 20, y: 20 },
              { x: 40, y: 20 },
              { x: 40, y: 40 },
              { x: 20, y: 40 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

function rectangle(minX: number, maxX: number) {
  return {
    points: [
      { x: minX, y: 20 },
      { x: maxX, y: 20 },
      { x: maxX, y: 40 },
      { x: minX, y: 40 },
    ],
    closed: true,
  };
}
