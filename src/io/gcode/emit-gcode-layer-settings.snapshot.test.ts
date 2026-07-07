// Distinct per-layer settings through the SHIPPED composition (emitGcode:
// pre-emit guard → compileJob → applyJobOrigin → optimizePaths → strategy →
// preflight). Companion to emit-gcode.snapshot.test.ts, whose mixed fixture
// runs every layer at the same default 30%/1500 and therefore cannot catch
// layers receiving each other's settings (audit 2026-07-07 gap). Here the
// three modes carry three DIFFERENT power/speed/passes, byte-pinned plus
// asserted per section — the "massive multi-layer job" contract in miniature.

import { describe, expect, it } from 'vitest';
import {
  collectG1FValues,
  collectG1SValues,
  expectedS,
  findLaserOnTravelIssues,
  findOutOfBoundsCoords,
  splitGcodeLayerSections,
} from '../../core/invariants';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

const CUT = { id: 'cut-red', color: '#ff0000', power: 60, speed: 1200, passes: 2 };
const FILL = { id: 'fill-blue', color: '#0000ff', power: 35, speed: 3000, passes: 1 };
const IMAGE = { id: 'image-gray', color: '#808080', power: 45, speed: 2500, passes: 1 };

function cutLineObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'C1',
    source: 'cut.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: CUT.color,
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 30, y: 10 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

// A solid 20×20 square: enough scanlines (2 mm hatch) to exercise the fill
// sweep path without a large snapshot.
function fillSquareObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'F1',
    source: 'square.svg',
    bounds: { minX: 50, minY: 50, maxX: 70, maxY: 70 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: FILL.color,
        polylines: [
          {
            points: [
              { x: 50, y: 50 },
              { x: 70, y: 50 },
              { x: 70, y: 70 },
              { x: 50, y: 70 },
              { x: 50, y: 50 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

// 2×2 source pixels (black, white / white, black) on a 10×5 mm footprint —
// threshold dither maps ink to the layer's full power S and skips white.
function rasterObject(): SceneObject {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: 'AP//AA==',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 100, minY: 100, maxX: 110, maxY: 105 },
    transform: IDENTITY_TRANSFORM,
    color: IMAGE.color,
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function distinctSettingsProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [cutLineObject(), fillSquareObject(), rasterObject()],
      layers: [
        { ...createLayer({ id: CUT.id, color: CUT.color }), ...CUT },
        {
          ...createLayer({ id: FILL.id, color: FILL.color, mode: 'fill' }),
          ...FILL,
          hatchSpacingMm: 2,
        },
        {
          ...createLayer({ id: IMAGE.id, color: IMAGE.color, mode: 'image' }),
          ...IMAGE,
          ditherAlgorithm: 'threshold',
          linesPerMm: 1,
        },
      ],
    },
  };
}

describe('emitGcode with distinct per-layer settings', () => {
  it('byte-pins the three-mode, three-settings program', () => {
    const { gcode, preflight } = emitGcode(distinctSettingsProject());
    expect(preflight.ok).toBe(true);
    expect(gcode).toMatchSnapshot();
  });

  it('emits the three layer sections in Cuts/Layers order', () => {
    const { gcode } = emitGcode(distinctSettingsProject());
    expect(splitGcodeLayerSections(gcode).map((s) => s.layerId)).toEqual([
      CUT.id,
      FILL.id,
      IMAGE.id,
    ]);
  });

  it("each section burns only at its OWN layer's S (plus S0 blanks)", () => {
    const { gcode } = emitGcode(distinctSettingsProject());
    const p = distinctSettingsProject();
    const sections = splitGcodeLayerSections(gcode);
    for (const [i, layer] of [CUT, FILL, IMAGE].entries()) {
      const body = sections[i]?.body ?? '';
      const want = expectedS(layer.power, p.device.maxPowerS);
      const sValues = collectG1SValues(body);
      expect(sValues).toContain(want);
      for (const s of sValues) expect([0, want]).toContain(s);
    }
  });

  it("each section feeds only at its OWN layer's speed", () => {
    const { gcode } = emitGcode(distinctSettingsProject());
    const sections = splitGcodeLayerSections(gcode);
    for (const [i, layer] of [CUT, FILL, IMAGE].entries()) {
      const fValues = collectG1FValues(sections[i]?.body ?? '');
      expect(fValues.length).toBeGreaterThan(0);
      for (const f of fValues) expect(f).toBe(layer.speed);
    }
  });

  it('runs the cut layer exactly twice (passes 2) and the others once', () => {
    const { gcode } = emitGcode(distinctSettingsProject());
    const sections = splitGcodeLayerSections(gcode);
    expect(sections[0]?.body.match(/^; pass 2 of 2$/gm)).toHaveLength(1);
    expect(sections[1]?.body).toContain('; pass 1 of 1');
    expect(sections[1]?.body).not.toContain('of 2');
  });

  it('holds the whole-program safety invariants', () => {
    const p = distinctSettingsProject();
    const { gcode } = emitGcode(p);
    expect(findLaserOnTravelIssues(gcode)).toEqual([]);
    expect(
      findOutOfBoundsCoords(gcode, { width: p.device.bedWidth, height: p.device.bedHeight }),
    ).toEqual([]);
  });

  it('is deterministic (two runs byte-identical)', () => {
    expect(emitGcode(distinctSettingsProject()).gcode).toBe(
      emitGcode(distinctSettingsProject()).gcode,
    );
  });
});
