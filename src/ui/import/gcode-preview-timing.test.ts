import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { parseGcodeProgram } from '../../io/gcode';
import { analyzeGcodeModel } from '../gcode-inspector/gcode-inspector-analysis';
import type { GcodeInspectionContext } from '../gcode-inspector/gcode-inspection-source';
import { elapsedSecondsAtScrubber, scrubberAtElapsedSeconds } from '../workspace/preview-timeline';
import { parseTimedGcodePreview } from './gcode-preview-timing';
import { packGcodeResult, unpackGcodeResult } from './packed-gcode-result';
import { parseGcodeBlob } from './parse-gcode-blob';
import { CANVAS_PROGRAM_ANALYSIS_LINE_BUDGET } from '../state/canvas-program-analysis-budget';

const CONTEXT: GcodeInspectionContext = {
  machineKind: 'cnc',
  timing: {
    limits: { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 },
    deviceName: 'Fixture CNC',
  },
};

describe('source-owned imported preview timing', () => {
  it('keeps different feeds within one cut category instead of distributing all time by distance', () => {
    const result = timed('G21 G90\nG1 X100 F60\nG1 X200 F6000');
    const halfway = elapsedSecondsAtScrubber(result.timeline, 0.5);
    expect(halfway).toBeGreaterThan(99);
    expect(result.timeline.totalSeconds - halfway).toBeLessThan(2);
  });

  it('times pure Z and helical arc motion with the same model as the Inspector', () => {
    const text = 'G21 G90\nG0 X10 Z5\nG1 Z-2 F60\nG3 X-10 Y0 Z-4 I-10 J0 F300\nG0 Z5';
    const preview = timed(text);
    const parsed = buildGcodeRenderModel(text, {
      machineKind: 'cnc',
      retainPreciseSegmentLengths: true,
    });
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    const inspector = analyzeGcodeModel(parsed.model, CONTEXT);
    expect(preview.estimate.totalSeconds).toBeCloseTo(inspector.time.totalSeconds, 10);
    expect(preview.timeline.totalSeconds).toBeCloseTo(inspector.time.totalSeconds, 10);
    expect(preview.toolpath).toEqual(okGeometry(text));
  });

  it('preserves relative inch feeds and units across source lines', () => {
    const inch = timed('G20 G91\nG1 X1 F60\nG1 X1 F600');
    const mm = timed('G21 G91\nG1 X25.4 F1524\nG1 X25.4 F15240');
    expect(inch.estimate.totalSeconds).toBeCloseTo(mm.estimate.totalSeconds, 10);
    expect(inch.timeline.totalDistanceMm).toBeCloseTo(50.8, 10);
  });

  it('keeps leading, middle and trailing dwells stationary and excludes unknown manual pause duration', () => {
    const result = timed('G21\nG4 P2\nG1 X10 F600\nG4 P3\nM0\nG1 X20 F600\nG4 P4');
    const segments = result.timeline.segments;
    expect(result.estimate.breakdown.dwellSeconds).toBe(9);
    expect(result.estimate.manualPauseCount).toBe(1);
    expect(scrubberAtElapsedSeconds(result.timeline, 1)).toBe(0);
    expect(scrubberAtElapsedSeconds(result.timeline, (segments[2]?.startSeconds ?? 0) + 1)).toBe(
      0.5,
    );
    expect(scrubberAtElapsedSeconds(result.timeline, result.timeline.totalSeconds - 1)).toBe(1);
  });

  it.each([
    'G21\nG1 X10',
    'G21\nG81 X10 F60',
    'G21\nG92 X0\nG1 X10 F60',
    'G21\nG1 X10 F60\nunreadable junk',
  ])('retains geometry with an unavailable ETA for %s', (text) => {
    const result = parseTimedGcodePreview(text, CONTEXT);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.toolpath.totalLength).toBeGreaterThan(0);
    expect(result.timing?.estimate.kind).toBe('preparation-failed');
    expect(result.timing?.timeline).toBeNull();
  });

  it('keeps Blob worker parsing and the packed transfer identical to text timing', async () => {
    const text = 'G21\r\nG4 P2\r\nG1 X10 F60\r\nG1 X20 F600\r\n';
    const parsed = await parseGcodeBlob(
      new NodeBlob([text]) as unknown as Blob,
      undefined,
      CONTEXT,
    );
    expect(parsed).toEqual(parseTimedGcodePreview(text, CONTEXT));
    expect(unpackGcodeResult(structuredClone(packGcodeResult(parsed)))).toEqual(parsed);
  });

  it('bounds optional timing for a large source while preserving every geometric move', () => {
    const count = CANVAS_PROGRAM_ANALYSIS_LINE_BUDGET + 2;
    const text = Array.from({ length: count }, (_, index) => `G1 X${index + 1} F600`).join('\n');
    const result = parseTimedGcodePreview(text, CONTEXT);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.toolpath.steps).toHaveLength(count);
    expect(result.toolpath.totalLength).toBe(count);
    expect(result.timing?.estimate.kind).toBe('preparation-failed');
    expect(result.timing?.description).toContain('timing line budget');
  });

  it('bounds expanded timing arcs without discarding the imported arcs', () => {
    const text = 'G0 X100\n' + 'G2 X100 I-100 F600\n'.repeat(300);
    const result = parseTimedGcodePreview(text, CONTEXT);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.toolpath.steps).toHaveLength(301);
    expect(result.timing?.estimate.kind).toBe('preparation-failed');
    expect(result.timing?.description).toContain('timing segment budget');
  });
});

function timed(text: string) {
  const result = parseTimedGcodePreview(text, CONTEXT);
  if (
    result.kind !== 'ok' ||
    result.timing?.estimate.kind !== 'estimated' ||
    result.timing.timeline === null
  )
    throw new Error(JSON.stringify(result));
  return {
    toolpath: result.toolpath,
    estimate: result.timing.estimate,
    timeline: result.timing.timeline,
  };
}

function okGeometry(text: string) {
  const parsed = parseGcodeProgram(text);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  return parsed.toolpath;
}
