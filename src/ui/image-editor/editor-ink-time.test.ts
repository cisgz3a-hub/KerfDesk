import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { computeInkTimeReadout } from './editor-ink-time';
import { createSession } from './editor-session';

// 100×100 px mapped onto 100×100 mm (1 px = 1 mm).
const BOUNDS = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

function raster(color = '#808080'): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 100,
    pixelHeight: 100,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAA=',
  };
}

function projectWith(mode: 'image' | 'line', speed = 600): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [raster()],
      layers: [
        { ...createLayer({ id: 'L1', color: '#808080', mode }), speed, linesPerMm: 2, passes: 1 },
      ],
    },
  };
}

// Ink: rows 10..19 (10 rows), columns 20..59 (40 px wide) = 400 px = 4%.
function inkSession() {
  const doc = createRgbaBuffer(100, 100);
  for (let y = 10; y < 20; y += 1) {
    for (let x = 20; x < 60; x += 1) {
      const base = (y * 100 + x) * 4;
      doc.data[base] = 0;
      doc.data[base + 1] = 0;
      doc.data[base + 2] = 0;
    }
  }
  return createSession('R1', 'source.png', doc, BOUNDS);
}

describe('computeInkTimeReadout', () => {
  it('reports coverage and the scanline estimate for an Image-mode layer', () => {
    const readout = computeInkTimeReadout(inkSession(), projectWith('image'));
    expect(readout.inkPercent).toBe(4);
    expect(readout.estimate.kind).toBe('estimated');
    if (readout.estimate.kind !== 'estimated') return;
    // 10 ink rows × 1 mm × 2 lines/mm = 20 machine rows;
    // 40 mm ink width ÷ (600/60 = 10 mm/s) = 4 s per row → 80 s.
    expect(readout.estimate.seconds).toBeCloseTo(80, 5);
    expect(readout.estimate.layerName.length).toBeGreaterThan(0);
  });

  it('falls back to no-image-layer for line-mode layers', () => {
    const readout = computeInkTimeReadout(inkSession(), projectWith('line'));
    expect(readout.estimate.kind).toBe('no-image-layer');
  });

  it('applies per-object operation overrides (half speed = double time)', () => {
    const project = projectWith('image');
    const object = project.scene.objects[0];
    if (object === undefined) throw new Error('fixture');
    const overridden: Project = {
      ...project,
      scene: {
        ...project.scene,
        objects: [{ ...object, operationOverride: { speed: 300 } }],
      },
    };
    const readout = computeInkTimeReadout(inkSession(), overridden);
    expect(readout.estimate.kind).toBe('estimated');
    if (readout.estimate.kind !== 'estimated') return;
    expect(readout.estimate.seconds).toBeCloseTo(160, 5);
  });

  it('an all-white document reports 0% and no estimate', () => {
    const session = createSession('R1', 'source.png', createRgbaBuffer(50, 50), BOUNDS);
    const readout = computeInkTimeReadout(session, projectWith('image'));
    expect(readout.inkPercent).toBe(0);
    expect(readout.estimate.kind).toBe('no-image-layer');
  });
});
