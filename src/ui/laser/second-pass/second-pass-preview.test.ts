import { describe, expect, it } from 'vitest';
import { toMachineCoords } from '../../../core/devices';
import { createProject } from '../../../core/scene';
import { secondPassDrawing, sourceInitialPosition } from './second-pass-preview';
import { createCurrentTestExecutionArtifact } from '../../state/recovery/testing/execution-artifact-test-fixture';

describe('painted pass preview coordinates', () => {
  it.each(['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const)(
    'maps source work millimetres through %s and back without changing placement',
    (origin) => {
      const device = { ...createProject().device, origin, maxPowerS: 1000 };
      const drawing = secondPassDrawing(
        'G21\nG90\nM4 S0\nG0 X37.25 Y-12.5\nG1 X41.75 Y-10.25 F1800 S300\nM5',
        device,
      );
      expect(drawing.segments).toHaveLength(5);
      expect(toMachineCoords({ x: drawing.segments[0]!, y: drawing.segments[1]! }, device)).toEqual(
        { x: 37.25, y: -12.5 },
      );
      expect(toMachineCoords({ x: drawing.segments[2]!, y: drawing.segments[3]! }, device)).toEqual(
        { x: 41.75, y: -10.25 },
      );
      expect(drawing.segments[4]).toBe(0.3);
    },
  );
  it('ignores comment S words, dark moves, and rapid motion in tonal source artwork', () => {
    const drawing = secondPassDrawing(
      'G21\nG90\nM4 S0\nG0 X0 Y0\nG1 X5 F1200 S250 ; S999\nG1 X10 S0\nG0 X20\nG1 X25 S750\nM5',
      createProject().device,
    );
    expect(drawing.segments).toHaveLength(10);
    expect(drawing.segments[4]).toBe(0.25);
    expect(drawing.segments[9]).toBe(0.75);
  });
  it('does not invent the start of a relative burn', () => {
    expect(() =>
      secondPassDrawing('G91\nM4 S0\nG1 X5 F1200 S250\nM5', createProject().device),
    ).toThrow(/starting/);
  });
  it('normalises archived inches for a known relative source, without treating it as live position evidence', async () => {
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'second-pass-inch-source',
      controllerSettings: { reportInches: true },
      controllerObservation: {
        statusReport: {
          state: 'Idle',
          subState: null,
          mPos: null,
          wPos: { x: 1, y: 2, z: 0 },
          wco: null,
          feed: 0,
          spindle: 0,
        },
      },
    });
    expect(sourceInitialPosition(artifact)).toEqual({ x: 25.4, y: 50.8, z: 0 });
  });
});
