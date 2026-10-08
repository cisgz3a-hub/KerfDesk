import { describe, expect, it } from 'vitest';
import { buildProgramTime } from '../../core/gcode-time';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { inspectGcodeText } from './gcode-inspector-parse';
import { gcodeInspectorTransferables } from './gcode-inspector-transferables';
import { hasGcodeInspectorAnalysis } from './gcode-inspector-worker-protocol';
import { secondsAtPick } from './pick-readout';
import { advance, initialTransport } from './playback-transport';
import { playheadAtTime, secondsAtLine, stepMoveSeconds, trailStartSegment } from './playhead';

const LIMITS = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };
const TAIL_MOVES = 24;

// A 200 × 180 mm engraving at 0.1 mm pitch and F600 takes about ten hours.
// The finishing moves remain ordinary geometry after that long motion clock.
function longRaster(rows: number, tailStepMm: number): string {
  const lines = ['G21 G90', 'M4 S100'];
  for (let row = 1; row <= rows; row += 1) {
    lines.push('G1 X' + (row % 2 === 1 ? 200 : 0) + ' Y' + (row * 0.1).toFixed(1) + ' F600');
  }
  lines.push('G1 X100 F6000');
  for (let move = 1; move <= TAIL_MOVES; move += 1) {
    lines.push('G1 X' + (100 + move * tailStepMm).toFixed(6));
  }
  return lines.join('\n');
}

function timed(rows: number, tailStepMm: number) {
  const parsed = buildGcodeRenderModel(longRaster(rows, tailStepMm), {
    machineKind: 'laser',
    retainPreciseSegmentLengths: true,
  });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const model = parsed.model;
  const time = buildProgramTime(model, LIMITS, { machineKind: 'laser' });
  // Independent reference from the planner's non-cumulative move durations.
  const exactEnds = new Float64Array(model.segmentCount);
  let elapsed = 0;
  for (let index = 0; index < model.segmentCount; index += 1) {
    elapsed += time.segSeconds[index] ?? 0;
    exactEnds[index] = elapsed;
  }
  return { model, time, exactEnds };
}

function endpoint(model: Pick<GcodeRenderModel, 'positions'>, index: number) {
  const base = index * 6 + 3;
  return {
    x: model.positions[base],
    y: model.positions[base + 1],
    z: model.positions[base + 2],
  };
}

describe('Inspector playback precision after a long job', () => {
  it('retains distinct endpoints for positive short moves and the exact motion total', () => {
    const { model, time } = timed(1800, 0.05);
    expect(time.motionSeconds).toBeGreaterThan(36_000);
    for (let index = model.segmentCount - TAIL_MOVES; index < model.segmentCount; index += 1) {
      expect(time.segSeconds[index]).toBeGreaterThan(0);
      expect(time.segTimeEndSec[index]).toBeGreaterThan(time.segTimeEndSec[index - 1] ?? 0);
    }
    expect(time.segTimeEndSec[model.segmentCount - 1]).toBe(time.motionSeconds);
  });

  it.each([
    [900, 0.05],
    [1800, 0.001],
  ])('reaches the last move after %i raster rows and %f mm finish steps', (rows, tailStepMm) => {
    const { model, time } = timed(rows, tailStepMm);
    const last = model.segmentCount - 1;
    const states = [
      initialTransport(time.motionSeconds),
      advance({ seconds: time.motionSeconds - 0.01, playing: true }, 0.1, 1, time.motionSeconds),
    ];
    for (const transport of states) {
      expect(transport).toEqual({ seconds: time.motionSeconds, playing: false });
      const playhead = playheadAtTime(model, time.segTimeEndSec, transport.seconds);
      expect(playhead.segmentIndex).toBe(last);
      expect(playhead.segmentFraction).toBe(1);
      expect(playhead.point).toEqual(endpoint(model, last));
    }
  });

  it('interpolates every finishing move from its own planner time', () => {
    const { model, time, exactEnds } = timed(1800, 0.05);
    for (let index = model.segmentCount - TAIL_MOVES; index < model.segmentCount; index += 1) {
      const start = exactEnds[index - 1] ?? 0;
      const end = exactEnds[index] ?? start;
      const playhead = playheadAtTime(model, time.segTimeEndSec, start + (end - start) / 2);
      expect(playhead.segmentIndex).toBe(index);
      expect(playhead.segmentFraction).toBeCloseTo(0.5, 6);
      const from = endpoint(model, index - 1);
      const to = endpoint(model, index);
      expect(playhead.point?.x).toBeCloseTo(((from.x ?? 0) + (to.x ?? 0)) / 2, 6);
    }
  });

  it('uses the same precise times for pick, source, move-step and trail navigation', () => {
    const { model, time, exactEnds } = timed(1800, 0.05);
    for (let index = model.segmentCount - TAIL_MOVES; index < model.segmentCount; index += 1) {
      const start = exactEnds[index - 1] ?? 0;
      const end = exactEnds[index] ?? start;
      const middle = start + (end - start) / 2;
      expect(secondsAtPick(time.segTimeEndSec, { segmentIndex: index, fraction: 0.5 })).toBe(
        middle,
      );
      expect(secondsAtLine(model, time.segTimeEndSec, model.segLine[index] ?? 0)).toBe(start);
      expect(stepMoveSeconds(time.segTimeEndSec, model.segmentCount, start, 1)).toBe(end);
      expect(stepMoveSeconds(time.segTimeEndSec, model.segmentCount, end, -1)).toBe(start);
      expect(trailStartSegment(time.segTimeEndSec, model.segmentCount, middle + 1, 1)).toBe(index);
    }
  });

  it.each([1, -1] as const)(
    'steps in direction %i without skipping a positive boundary interval',
    (direction) => {
      const { model, time, exactEnds } = timed(1800, 0.001);
      for (let index = model.segmentCount - TAIL_MOVES; index < model.segmentCount; index += 1) {
        const start = exactEnds[index - 1] ?? 0;
        const end = exactEnds[index] ?? start;
        const offset = Math.min((end - start) / 4, 0.00005);
        const seconds = direction > 0 ? end - offset : start + offset;
        const expected = direction > 0 ? end : start;
        expect(stepMoveSeconds(time.segTimeEndSec, model.segmentCount, seconds, direction)).toBe(
          expected,
        );
      }
    },
  );

  it('skips only zero-duration moves and clamps stepping outside the clock', () => {
    const ends = new Float64Array([0, 1, 1, 3, 3]);
    expect(stepMoveSeconds(ends, 5, 0, 1)).toBe(1);
    expect(stepMoveSeconds(ends, 5, 1, 1)).toBe(3);
    expect(stepMoveSeconds(ends, 5, 3, 1)).toBe(3);
    expect(stepMoveSeconds(ends, 5, 1, -1)).toBe(0);
    expect(stepMoveSeconds(ends, 5, 3, -1)).toBe(1);
    expect(stepMoveSeconds(ends, 5, 0, -1)).toBe(0);
    expect(stepMoveSeconds(ends, 5, -5, 1)).toBe(0);
    expect(stepMoveSeconds(ends, 5, -5, -1)).toBe(0);
    expect(stepMoveSeconds(ends, 5, 999, 1)).toBe(3);
    expect(stepMoveSeconds(ends, 5, 999, -1)).toBe(3);
    expect(stepMoveSeconds(ends, 0, 2, 1)).toBe(0);
  });

  it('preserves the long-job clock through the Inspector worker transfer', () => {
    const inspected = inspectGcodeText(longRaster(1800, 0.001), { machineKind: 'laser' });
    if (!hasGcodeInspectorAnalysis(inspected)) throw new Error('Expected a parsed program');
    const originalEnds = inspected.analysis.time.segTimeEndSec;
    const transferred = structuredClone(inspected, {
      transfer: [...gcodeInspectorTransferables(inspected)],
    });
    expect(originalEnds.byteLength).toBe(0);
    if (!hasGcodeInspectorAnalysis(transferred)) throw new Error('Expected transferred analysis');
    const model = transferred.parsed.model;
    const time = transferred.analysis.time;
    // structuredClone crosses the Node/jsdom realm boundary, so inspect the native tag.
    expect(ArrayBuffer.isView(time.segTimeEndSec)).toBe(true);
    expect(Object.prototype.toString.call(time.segTimeEndSec)).toBe('[object Float64Array]');
    expect(time.segTimeEndSec.byteLength).toBe(model.segmentCount * Float64Array.BYTES_PER_ELEMENT);
    expect(time.segTimeEndSec[model.segmentCount - 1]).toBe(time.motionSeconds);
    const playhead = playheadAtTime(model, time.segTimeEndSec, time.motionSeconds);
    expect(playhead.segmentIndex).toBe(model.segmentCount - 1);
    expect(playhead.segmentFraction).toBe(1);
    expect(playhead.point).toEqual(endpoint(model, model.segmentCount - 1));
  });
});
