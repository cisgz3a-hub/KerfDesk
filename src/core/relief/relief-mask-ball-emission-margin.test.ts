import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncPass, Job } from '../job';
import { cncGrblStrategy } from '../output';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type CncTool,
  type Transform,
  type Vec2,
} from '../scene';
import { cuttingSurfaceDz, kernelForTool } from '../sim/tool-kernels';
import type { Heightmap } from './heightmap';
import { reliefFinishingPasses } from './relief-finishing';

const TOOL: CncTool = {
  id: 'mask-margin-ball',
  name: '0.6 mm mask-margin ball nose',
  kind: 'ball-nose',
  diameterMm: 0.6,
};
const TRANSFORM: Transform = {
  ...IDENTITY_TRANSFORM,
  x: 19.718129180866868,
  y: 11.039871519308113,
  rotationDeg: 37,
};
const EXPECTED_CUT_LINE = 'G1 X20.217 Y11.541 Z-0.016 F200';

describe('ball-nose relief mask margin after emitted-coordinate rounding', () => {
  it('keeps a rotated fractional-radius boundary pass outside excluded stock', () => {
    const map = isolatedIncludedCellMap();
    const passes = reliefFinishingPasses(map, {
      tool: TOOL,
      kernel: kernelForTool(TOOL, map.mmPerCell),
      scallopMm: 0.025,
    });
    expect(passes).toHaveLength(1);

    const transformedPasses: ReadonlyArray<CncPass> = passes.map((pass) => {
      if (pass.kind !== 'path3d') throw new Error('path3d finishing pass expected');
      return {
        ...pass,
        points: pass.points.map((point) => ({
          ...applyTransform(point, TRANSFORM),
          z: point.z,
        })),
      };
    });
    const gcode = cncGrblStrategy.emit(jobFor(transformedPasses), {
      ...DEFAULT_DEVICE_PROFILE,
      origin: 'rear-left',
    });
    const cutLine = gcode.split(/\r?\n/u).find((line) => line === EXPECTED_CUT_LINE);
    expect(cutLine).toBe(EXPECTED_CUT_LINE);
    if (cutLine === undefined) throw new Error('expected emitted boundary cut line');

    const emittedAxis = {
      x: coordinateWord(cutLine, 'X'),
      y: coordinateWord(cutLine, 'Y'),
    };
    const emittedZ = coordinateWord(cutLine, 'Z');
    const localAxis = inverseRigidTransform(emittedAxis, TRANSFORM);
    const distanceToExcludedCell = Math.hypot(
      axisGap(localAxis.x, 0.2, 0.4),
      axisGap(localAxis.y, 0, 0.2),
    );
    const radiusMm = TOOL.diameterMm / 2;
    const emittedMarginMm =
      distanceToExcludedCell > radiusMm
        ? distanceToExcludedCell - radiusMm
        : emittedZ + cuttingSurfaceDz(TOOL, distanceToExcludedCell, radiusMm);

    expect(emittedMarginMm).toBeGreaterThanOrEqual(0);
  });
});

function isolatedIncludedCellMap(): Heightmap {
  return {
    widthCells: 4,
    heightCells: 1,
    mmPerCell: 0.2,
    depth: new Float32Array(4).fill(-0.6),
    inclusion: Uint8Array.from([0, 0, 0, 1]),
  };
}

function jobFor(passes: ReadonlyArray<CncPass>): Job {
  return {
    groups: [
      {
        kind: 'cnc',
        layerId: 'mask-margin',
        color: '#79512f',
        cutType: 'relief-finish',
        toolId: TOOL.id,
        toolName: TOOL.name,
        toolDiameterMm: TOOL.diameterMm,
        feedMmPerMin: 500,
        plungeMmPerMin: 200,
        spindleRpm: 12_000,
        spindleSpinupSec: 0,
        safeZMm: 3,
        retractBetweenPasses: false,
        passes,
      },
    ],
  };
}

function coordinateWord(line: string, axis: 'X' | 'Y' | 'Z'): number {
  const value = new RegExp(`${axis}(-?\\d+(?:\\.\\d+)?)`, 'u').exec(line)?.[1];
  if (value === undefined) throw new Error(`${axis} coordinate expected`);
  return Number(value);
}

function inverseRigidTransform(point: Vec2, transform: Transform): Vec2 {
  const x = point.x - transform.x;
  const y = point.y - transform.y;
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: x * cos + y * sin,
    y: -x * sin + y * cos,
  };
}

function axisGap(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  return value > max ? value - max : 0;
}
