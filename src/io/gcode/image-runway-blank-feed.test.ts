import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { runPreflight } from '../../core/preflight';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

// Rolling audit v2 03-P2-7 (ADR-415 Amendment 1): image runways are laser-off
// feed moves the operator asked for, so they carry the laser-off marker the
// Fill runways carry, and preflight excuses them up to the image overscan
// (ADR-415 §4, ADR-495 §4) instead of calling them a stale export.

const COLOR = '#808080';

function imageProject(layer: Partial<Layer>): Project {
  const raster: SceneObject = {
    kind: 'raster-image',
    id: 'R1',
    color: COLOR,
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'floyd-steinberg',
    linesPerMm: 4,
    // 4×4 = 16 zero bytes: every pixel burns.
    lumaBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
    bounds: { minX: 50, minY: 50, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
  };
  const base = createProject(DEFAULT_DEVICE_PROFILE);
  return {
    ...base,
    scene: addLayer(addObject(base.scene, raster), {
      ...createLayer({ id: 'L1', color: COLOR, mode: 'image' }),
      ...layer,
    }),
  };
}

function blankFeedIssues(project: Project, gcode: string) {
  return runPreflight(project, gcode).issues.filter((issue) => issue.code === 'long-blank-feed');
}

describe('image runways are marked laser-off motion (03-P2-7)', () => {
  it('raises no long-blank-feed for a 10 mm image overscan', () => {
    const project = imageProject({ imageOverscanMm: 10 });
    const result = emitGcode(project);

    expect(result.gcode).not.toBe('');
    expect(result.preflight.issues.filter((issue) => issue.code === 'long-blank-feed')).toEqual([]);
    // Both runways of a row (the default dialect packs its words): into the
    // image at the held S0, and out past it.
    expect(result.gcode).toMatch(/^G1X50F1500 ; kerfdesk:laser-off-motion$/m);
    expect(result.gcode).toMatch(/^X70S0 ; kerfdesk:laser-off-motion$/m);
  });

  it('marks the runways of a reverse row and of one-way rows', () => {
    const result = emitGcode(imageProject({ imageOverscanMm: 10, imageBidirectional: true }));
    const oneWay = emitGcode(imageProject({ imageOverscanMm: 10, imageBidirectional: false }));

    expect(result.gcode).toMatch(/^G1X60 ; kerfdesk:laser-off-motion$/m);
    expect(result.gcode).toMatch(/^X40S0 ; kerfdesk:laser-off-motion$/m);
    expect(oneWay.gcode).not.toMatch(/^X40S0/m);
    expect(oneWay.preflight.issues.filter((issue) => issue.code === 'long-blank-feed')).toEqual([]);
    expect(result.preflight.issues.filter((issue) => issue.code === 'long-blank-feed')).toEqual([]);
  });

  it('marks nothing when the image has no overscan', () => {
    const result = emitGcode(imageProject({ imageOverscanMm: 0 }));

    expect(result.gcode).not.toContain('kerfdesk:laser-off-motion');
  });

  it('still reports real long blank feeds next to the image', () => {
    const project = imageProject({ imageOverscanMm: 10 });
    const unmarked = ['G21', 'G90', 'M4 S0', 'G0 X0 Y0 S0', 'G1 X8 Y0 F1500 S0', 'M5'];
    const overlong = [
      'G21',
      'G90',
      'M4 S0',
      'G0 X0 Y0 S0',
      'G1 X12 Y0 F1500 S0 ; kerfdesk:laser-off-motion',
      'M5',
    ];

    expect(blankFeedIssues(project, unmarked.join('\n'))).toHaveLength(1);
    expect(blankFeedIssues(project, overlong.join('\n'))).toHaveLength(1);
  });
});
