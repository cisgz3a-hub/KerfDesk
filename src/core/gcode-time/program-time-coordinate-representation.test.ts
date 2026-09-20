import { describe, expect, it } from 'vitest';
import { representedCncCoordinateMm } from '../cnc/coordinate-representation';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../devices';
import { buildGcodeRenderModel, type BuildRenderModelOptions } from '../gcode-view';
import { buildProgramTimeline } from './program-timeline';
import { deviceProgramTimingOptions } from './program-timing-options';

const coordinate = 6553.606;
const represented = representedCncCoordinateMm(coordinate);
const limits = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };

describe('controller-represented CNC timing coordinates', () => {
  it('retains the exact GRBL parsed boundary while keeping the emitted F word', () => {
    const model = parse('G1 X6553.606 Y0 Z-3000.001 F2650', {
      coordinateRepresentation: 'grbl',
    });
    const representedZ = representedCncCoordinateMm(-3000.001);
    expect(represented).toBe(6553.60546875);
    expect(represented).not.toBe(Math.fround(coordinate));
    expect(Array.from(model.positions)).toEqual([0, 0, 0, represented, 0, representedZ]);
    expect(Array.from(model.segFeed)).toEqual([2650]);
    expect(model.segLengthMm?.[0]).toBe(Math.hypot(represented, representedZ));
  });

  it('keeps precise arc length in the same represented XYZ/IJ coordinate frame', () => {
    const result = buildProgramTimeline('G0 X6553.606\nG3 X6553.606 I-3.001 J0 F60', limits, {
      coordinateRepresentation: 'grbl',
    });
    if (result.kind !== 'ok') throw new Error(result.reason);
    const radius = representedCncCoordinateMm(3.001);
    expect(result.timeline.totalRouteMm).toBeCloseTo(represented + 2 * Math.PI * radius, 10);
    expect(result.timeline.routeEndMm.at(-1)).toBe(result.timeline.totalRouteMm);
  });

  it('preserves an observed initial position without reformatting it as an emitted word', () => {
    const initialX = 12.3456789;
    const model = parse('G1 X6553.606 F60', {
      coordinateRepresentation: 'grbl',
      initialPositionMm: { x: initialX, y: 0, z: 0 },
    });
    expect(model.segLengthMm?.[0]).toBe(represented - initialX);
  });

  it('leaves generic parsing at its existing decimal representation', () => {
    const model = parse('G1 X6553.606 F60');
    expect(model.positions[3]).toBe(Math.fround(coordinate));
    expect(model.segLengthMm?.[0]).toBe(coordinate);
  });

  it.each<ControllerKind>(['grbl-v1.1', 'grblhal', 'fluidnc'])(
    'opts in only CNC timing on %s',
    (controllerKind) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, controllerKind };
      expect(deviceProgramTimingOptions(device, 'cnc').coordinateRepresentation).toBe('grbl');
      expect(deviceProgramTimingOptions(device, 'laser').coordinateRepresentation).toBeUndefined();
    },
  );

  it.each<ControllerKind>(['marlin', 'smoothieware', 'ruida'])(
    'preserves native %s coordinate parsing',
    (controllerKind) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, controllerKind };
      expect(deviceProgramTimingOptions(device, 'cnc').coordinateRepresentation).toBeUndefined();
    },
  );
});

function parse(gcode: string, options: BuildRenderModelOptions = {}) {
  const result = buildGcodeRenderModel(gcode, { ...options, retainPreciseSegmentLengths: true });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}
