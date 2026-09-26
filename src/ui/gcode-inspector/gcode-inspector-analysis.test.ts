import { describe, expect, it } from 'vitest';
import { buildProgramTime } from '../../core/gcode-time';
import { buildGcodeRenderModel, findProgramIssues } from '../../core/gcode-view';
import { analyzeGcodeModel } from './gcode-inspector-analysis';

describe('analyzeGcodeModel', () => {
  it('preserves the Inspector fixed-limit timeline and informational findings', () => {
    const accelMmPerSec2 = 500;
    const junctionDeviationMm = 0.01;
    const maxFeedMmPerMin = 6000;
    const parsed = buildGcodeRenderModel('G21 G90\nG0 X1 Y2\nG1 X4 Y2 F300\nM2');
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;

    const analysis = analyzeGcodeModel(parsed.model);
    expect(analysis.time).toEqual(
      buildProgramTime(parsed.model, {
        accelMmPerSec2,
        junctionDeviationMm,
        maxFeedMmPerMin,
      }),
    );
    expect(analysis.findings).toEqual(findProgramIssues(parsed.model));
  });

  it('plans against the context device and names it, as Job Review does (ADR-425)', () => {
    const parsed = buildGcodeRenderModel('G21 G90\nG0 X0 Y0\nG1 X200 F12000 S500\nM5\nG0 X0');
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;
    const limits = { accelMmPerSec2: 3000, junctionDeviationMm: 0.02, maxFeedMmPerMin: 12000 };

    const stock = analyzeGcodeModel(parsed.model);
    const timed = analyzeGcodeModel(parsed.model, {
      machineKind: 'laser',
      timing: { limits, cutTimeScale: 1.25, deviceName: 'Shop laser' },
    });

    expect(stock.timedFor).toBeNull();
    expect(timed.timedFor).toBe('Shop laser');
    expect(timed.time).toEqual(
      buildProgramTime(parsed.model, limits, { cutTimeScale: 1.25, machineKind: 'laser' }),
    );
    expect(timed.time.totalSeconds).toBeLessThan(stock.time.totalSeconds);
  });
});
