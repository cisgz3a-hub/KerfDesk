// ADR-218's double-line pairing is a trace artifact: it dedupes the two edges
// a boundary trace makes of one drawn stroke. A text glyph's counter is real
// type design — the Drive/Safe field incident (2026-08-01) cut a letter D
// with no counter because the glyph's two contours bbox-hug within one bit
// diameter, exactly like a traced ring. Pairing is therefore provenance
// scoped: text (and drawn shape) contours never pair; traces keep ADR-218.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type Polyline,
  type Scene,
  type SceneObject,
} from '../scene';
import type { CncPass } from '../job';
import { compileCncJob } from './compile-cnc-job';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG; // 1/8 in bit (3.175 mm)

function ring(at: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: at, y: at },
      { x: at + size, y: at },
      { x: at + size, y: at + size },
      { x: at, y: at + size },
    ],
  };
}

// A D-like glyph: the counter hugs the outer 1 mm inside on every side —
// tighter than the bit, so bbox geometry alone reads it as a traced pair.
const glyphOuter = ring(0, 15);
const glyphCounter = ring(1, 13);

function sceneFor(object: SceneObject, cnc: Partial<CncLayerSettings>): Scene {
  return {
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'profile-on-path',
          depthMm: 2,
          depthPerPassMm: 1,
          tabsEnabled: false,
          ...cnc,
        },
      },
    ],
    objects: [object],
  };
}

function passMinXs(scene: Scene): number[] {
  const job = compileCncJob(scene, dev, config);
  expect(job.groups).toHaveLength(1);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
  return group.passes.map((pass: CncPass) => {
    if (pass.kind !== 'contour') throw new Error('expected a contour pass');
    return Math.min(...pass.polyline.map((point) => point.x));
  });
}

const textObject: SceneObject = {
  kind: 'text',
  id: 'T1',
  content: 'D',
  fontKey: 'fixture-font',
  sizeMm: 15,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#ff0000',
  bounds: { minX: 0, minY: 0, maxX: 15, maxY: 15 },
  transform: IDENTITY_TRANSFORM,
  paths: [{ color: '#ff0000', polylines: [glyphOuter, glyphCounter] }],
};

const tracedObject: SceneObject = {
  kind: 'traced-image',
  id: 'TR1',
  source: 'drawing.png',
  bounds: { minX: 0, minY: 0, maxX: 15, maxY: 15 },
  transform: IDENTITY_TRANSFORM,
  paths: [{ color: '#ff0000', polylines: [glyphOuter, glyphCounter] }],
};

describe('compileCncJob line-art provenance scope', () => {
  it("keeps a text glyph's counter under the default 'inner' selection", () => {
    // Counter first (part-major inner-first), then outer — at both depths.
    expect(passMinXs(sceneFor(textObject, {}))).toEqual([1, 1, 0, 0]);
  });

  it("keeps a text glyph's counter under 'outer' (the field incident's setting)", () => {
    expect(passMinXs(sceneFor(textObject, { lineArtContours: 'outer' }))).toEqual([1, 1, 0, 0]);
  });

  it('still machines only the selected edge of a traced pair (ADR-218 kept)', () => {
    expect(passMinXs(sceneFor(tracedObject, {}))).toEqual([1, 1]);
    expect(passMinXs(sceneFor(tracedObject, { lineArtContours: 'outer' }))).toEqual([0, 0]);
  });
});
