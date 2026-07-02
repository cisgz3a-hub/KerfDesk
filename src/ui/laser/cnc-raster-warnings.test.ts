import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { detectCncRasterWarnings } from './cnc-raster-warnings';

function rasterObject(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,',
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#ff0000',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    ...overrides,
  };
}

function cncProject(objects: ReadonlyArray<SceneObject>, layerPatch: Partial<Layer> = {}): Project {
  const base = createProject();
  const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), ...layerPatch };
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [...objects], layers: [layer] },
  };
}

describe('detectCncRasterWarnings (ADR-100 §4)', () => {
  it('warns when a raster image sits on an output-enabled layer', () => {
    const warnings = detectCncRasterWarnings(cncProject([rasterObject()]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('1 raster image');
    expect(warnings[0]).toContain('skipped');
  });

  it('counts multiple dropped images in one advisory', () => {
    const warnings = detectCncRasterWarnings(
      cncProject([rasterObject(), rasterObject({ id: 'R2' })]),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2 raster images');
  });

  it('is silent when the raster layer has output disabled', () => {
    expect(detectCncRasterWarnings(cncProject([rasterObject()], { output: false }))).toEqual([]);
  });

  it('ignores trace-source reference rasters', () => {
    expect(detectCncRasterWarnings(cncProject([rasterObject({ role: 'trace-source' })]))).toEqual(
      [],
    );
  });

  it('is silent without rasters and for laser projects', () => {
    expect(detectCncRasterWarnings(cncProject([]))).toEqual([]);
    expect(detectCncRasterWarnings(createProject())).toEqual([]);
  });
});
