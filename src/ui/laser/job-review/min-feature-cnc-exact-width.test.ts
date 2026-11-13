// CNC audit v3 N3r-P2-2 (ADR-433 Amendment 6): a pocket arm, or the gap
// between an island and a wall, exactly as wide as the bit was left uncut with
// no warning. The planner insets by exactly the bit radius, so it collapses to
// a zero-width line and gets no path, while the minimum-feature check counted
// a width equal to the bit as enterable. 0.01 mm narrower warned; 0.001 mm
// wider was cut. Each case measures the emitted program first.

import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../../core/cnc';
import {
  carveMove,
  createHeightField,
  parseProgramMoves,
} from '../../../core/cnc/program-height-field.test-support';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../../../core/devices';
import { cncGrblStrategy } from '../../../core/output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncCutType,
  type Layer,
  type Polyline,
  type Project,
  type Vec2,
} from '../../../core/scene';
import { detectMinFeatureWarnings } from './min-feature-warnings';
import { checkProjectMinimumFeatures } from '../../../core/min-feature/project-check';

const BIT_MM = 6.35;
const DEPTH_MM = 2;

function loop(points: ReadonlyArray<readonly [number, number]>): Polyline {
  return { closed: true, points: points.map(([x, y]) => ({ x, y })) };
}

/** A 30 × 40 pocket with a 25 mm arm `width` wide off its right side. */
function arm(width: number): Polyline {
  return loop([
    [30, 30],
    [60, 30],
    [60, 45],
    [85, 45],
    [85, 45 + width],
    [60, 45 + width],
    [60, 70],
    [30, 70],
  ]);
}

function cncProject(polylines: ReadonlyArray<Polyline>, cutType: CncCutType = 'pocket'): Project {
  const layer: Layer = {
    ...createLayer({ id: 'cnc', color: '#000000' }),
    name: 'Router',
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType,
      toolId: 'em-6350',
      depthMm: DEPTH_MM,
      depthPerPassMm: DEPTH_MM,
    },
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [
        {
          kind: 'imported-svg',
          id: 'part',
          source: 'part.svg',
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#000000', polylines: [...polylines] }],
        },
      ],
      layers: [layer],
    },
  };
}

/** Whether the emitted program cuts the point down to the floor. */
function cutAt(project: Project, polylines: ReadonlyArray<Polyline>, point: Vec2): boolean {
  const job = compileCncJob(project.scene, project.device, DEFAULT_CNC_MACHINE_CONFIG);
  const moves = parseProgramMoves(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
  const machine = (p: Vec2): Vec2 => toMachineCoords(p, DEFAULT_DEVICE_PROFILE);
  const field = createHeightField(
    polylines.map((polyline) => polyline.points.map(machine)),
    0.1,
  );
  for (const move of moves) if (!move.rapid) carveMove(field, move, BIT_MM / 2);
  const at = machine(point);
  const index =
    Math.floor((at.y - field.minY) / field.cellMm) * field.width +
    Math.floor((at.x - field.minX) / field.cellMm);
  return (field.z[index] ?? 0) <= -DEPTH_MM + 0.01;
}

function widthFindings(project: Project): number {
  return checkProjectMinimumFeatures(project)[0]?.analysis.widths.count ?? 0;
}

describe('a CNC area exactly as wide as the bit (ADR-433 Amendment 6)', () => {
  it('warns about a pocket arm the program leaves uncut', () => {
    const shape = [arm(BIT_MM)];
    const project = cncProject(shape);
    expect(cutAt(project, shape, { x: 75, y: 45 + BIT_MM / 2 })).toBe(false);
    const warnings = detectMinFeatureWarnings(project);
    expect(warnings).toEqual([expect.stringContaining('1 area no wider than the 6.35 mm bit')]);
    expect(warnings[0]).toContain('no tool path enters it, so it stays uncut');
  });

  it('still says "narrower than" for an arm 0.01 mm narrower', () => {
    const warnings = detectMinFeatureWarnings(cncProject([arm(BIT_MM - 0.01)]));
    expect(warnings).toEqual([expect.stringContaining('1 area narrower than the 6.35 mm bit')]);
    expect(warnings[0]).toContain('the bit cannot enter it');
  });

  it('is silent about an arm 0.001 mm wider, which the program cuts', () => {
    const shape = [arm(BIT_MM + 0.001)];
    const project = cncProject(shape);
    expect(cutAt(project, shape, { x: 75, y: 45 + BIT_MM / 2 })).toBe(true);
    expect(widthFindings(project)).toBe(0);
  });

  it('warns about an island exactly one bit width from the wall', () => {
    const wall = loop([
      [20, 20],
      [80, 20],
      [80, 60],
      [20, 60],
    ]);
    const island = loop([
      [20 + BIT_MM, 30],
      [20 + BIT_MM, 50],
      [40, 50],
      [40, 30],
    ]);
    const project = cncProject([wall, island]);
    expect(cutAt(project, [wall, island], { x: 20 + BIT_MM / 2, y: 40 })).toBe(false);
    expect(widthFindings(project)).toBe(1);
  });

  it('leaves a gap exactly the bit wide alone on an Outside profile, which cuts it', () => {
    const left = loop([
      [20, 20],
      [40, 20],
      [40, 40],
      [20, 40],
    ]);
    const right = loop([
      [40 + BIT_MM, 20],
      [60, 20],
      [60, 40],
      [40 + BIT_MM, 40],
    ]);
    const report = checkProjectMinimumFeatures(cncProject([left, right], 'profile-outside'))[0];
    expect(report?.analysis.gaps.count).toBe(0);
  });
});
