import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { cncGrblStrategy } from '../../core/output/cnc-grbl-strategy';
import type { GcodeInspectionContext } from '../gcode-inspector/gcode-inspection-source';
import { scrubberAtElapsedSeconds } from '../workspace/preview-timeline';
import { parseTimedGcodePreview } from './gcode-preview-timing';

const CONTEXT: GcodeInspectionContext = {
  machineKind: 'cnc',
  timing: {
    limits: { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 },
    deviceName: 'Fixture CNC',
  },
};

function parsed(text: string, context = CONTEXT) {
  const result = parseTimedGcodePreview(text, context);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result;
}

describe('supported imported timing syntax and finite results', () => {
  it('retains the same arc geometry and timing with an explicit G91.1', () => {
    const source = 'G21 G90\nG0 X10\nG3 X-10 I-10 F600';
    const implicit = parsed(source);
    const explicit = parsed(`G91.1\n${source}`);
    expect(implicit.timing?.estimate.kind).toBe('estimated');
    expect(explicit.toolpath).toEqual(implicit.toolpath);
    expect(explicit.timing).toEqual(implicit.timing);
  });

  it.each([
    ['G54', 'G21 G90 G54 G94\nG1 X10 F600', CONTEXT],
    [
      'Marlin fan',
      'G21 G90\nM106 S128\nG1 X10 F600\nM107',
      { ...CONTEXT, machineKind: 'laser', laserPowerControl: 'fan' },
    ],
    [
      'Smoothieware',
      'G21 G90\nM221 S100 P0\nG1 X10 F600 S0.5\nM221 S0',
      { ...CONTEXT, machineKind: 'laser', laserPowerControl: 'smoothieware' },
    ],
  ] as const)('times represented %s commands', (_name, source, context) => {
    const result = parsed(source, context);
    expect(result.toolpath.totalLength).toBe(10);
    expect(result.timing?.estimate.kind).toBe('estimated');
    expect(result.timing?.timeline?.totalSeconds).toBeGreaterThan(1);
  });

  it('times the real CNC emitter preamble and spindle dwell', () => {
    const source = cncGrblStrategy.emit(
      {
        groups: [
          {
            kind: 'cnc',
            layerId: 'fixture',
            color: '#000000',
            cutType: 'profile-on-path',
            toolDiameterMm: 3.175,
            feedMmPerMin: 600,
            plungeMmPerMin: 300,
            spindleRpm: 12000,
            spindleSpinupSec: 2,
            safeZMm: 3,
            passes: [
              {
                kind: 'contour',
                zMm: -1,
                polyline: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                ],
                closed: false,
              },
            ],
          },
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );
    const result = parsed(source);
    expect(result.timing?.estimate).toMatchObject({
      kind: 'estimated',
      breakdown: { dwellSeconds: 2 },
    });
  });

  it.each(['G4 P3 G1 X10 F600', 'G1 X10 F600 G4 P3'])(
    'waits at the start of a combined dwell/motion block: %s',
    (block) => {
      const combined = parsed(`G21 G90\n${block}`);
      const separate = parsed('G21 G90\nG4 P3\nG1 X10 F600');
      expect(combined.timing).toEqual(separate.timing);
      const timeline = combined.timing?.timeline;
      if (timeline == null) throw new Error('missing timeline');
      expect(scrubberAtElapsedSeconds(timeline, 2)).toBe(0);
      expect(scrubberAtElapsedSeconds(timeline, 3.5)).toBeGreaterThan(0);
    },
  );

  it.each([`G4 P${'9'.repeat(400)}`, `G4 P${'9'.repeat(308)}\nG4 P${'9'.repeat(308)}`])(
    'keeps geometry but withholds overflowing dwell timing',
    (wait) => {
      const result = parsed(`G21 G90\nG1 X10 F600\n${wait}`);
      expect(result.toolpath.totalLength).toBe(10);
      expect(result.timing?.estimate.kind).toBe('preparation-failed');
      expect(result.timing?.timeline).toBeNull();
    },
  );

  it.each(['G90.1', 'G55', 'G92 X0', 'G93', 'G81', 'M999'])(
    'does not silently accept unrepresented syntax %s',
    (word) => {
      const result = parsed(`G21\n${word}\nG1 X10 F600`);
      expect(result.timing?.estimate.kind).toBe('preparation-failed');
      expect(result.timing?.timeline).toBeNull();
    },
  );

  it('keeps Smoothieware commands unavailable without the matching power model', () => {
    const result = parsed('M221 S100\nG1 X10 F600');
    expect(result.timing?.estimate.kind).toBe('preparation-failed');
  });
});
