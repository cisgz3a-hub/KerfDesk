import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { moveReadout, secondsAtPick } from './pick-readout';

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

// Line 3 rapids to X10, line 4 plunges, line 5 cuts to X30.
const PROGRAM = ['G21 G90', 'M3 S600', 'G0 X10 Y0', 'G1 Z-2 F200', 'G1 X30 Y0 F800', 'G0 Z5'].join(
  '\n',
);

function segmentOnLine(program: GcodeRenderModel, line: number): number {
  const index = program.segLine.indexOf(line);
  if (index < 0) throw new Error(`no move on line ${line}`);
  return index;
}

describe('moveReadout', () => {
  it('names the line, kind, point, feed and power of a cutting move', () => {
    const program = model(PROGRAM);
    const segmentIndex = segmentOnLine(program, 4);
    const readout = moveReadout(program, null, {
      segmentIndex,
      fraction: 0.5,
      point: { x: 20, y: 0, z: -2 },
    });
    expect(readout.line).toBe(4);
    expect(readout.title).toBe('Line 5 · Cut (G1)');
    expect(readout.position).toBe('X 20.00   Y 0.00   Z -2.00 mm');
    expect(readout.settings).toBe('F 800 mm/min   S 600');
    expect(readout.time).toBeNull();
  });

  it('calls a rapid a traversal and does not quote its modal feed', () => {
    const program = model(PROGRAM);
    const segmentIndex = segmentOnLine(program, 2);
    const readout = moveReadout(program, null, {
      segmentIndex,
      fraction: 1,
      point: { x: 10, y: 0, z: 0 },
    });
    expect(readout.title).toBe('Line 3 · Traversal (G0)');
    expect(readout.settings.startsWith('F rapid')).toBe(true);
  });

  it('leaves power out of a program that never sets it', () => {
    const program = model(['G21 G90', 'G1 X5 F300'].join('\n'));
    const readout = moveReadout(program, null, {
      segmentIndex: 0,
      fraction: 0,
      point: { x: 0, y: 0, z: 0 },
    });
    expect(readout.settings).toBe('F 300 mm/min');
  });

  it('says when the tool reaches the pointed point', () => {
    const program = model(PROGRAM);
    const times = new Float32Array(program.segmentCount).map((_, index) => (index + 1) * 30);
    const readout = moveReadout(program, times, {
      segmentIndex: 1,
      fraction: 0.5,
      point: { x: 10, y: 0, z: -1 },
    });
    expect(readout.seconds).toBe(45);
    expect(readout.time).toBe('Reached at 0:45');
  });
});

describe('secondsAtPick', () => {
  const times = new Float32Array([2, 6, 10]);

  it('interpolates along the move between its start and end times', () => {
    expect(secondsAtPick(times, { segmentIndex: 0, fraction: 0.5 })).toBe(1);
    expect(secondsAtPick(times, { segmentIndex: 2, fraction: 0.25 })).toBe(7);
  });

  it('clamps the fraction and refuses moves outside the timing', () => {
    expect(secondsAtPick(times, { segmentIndex: 1, fraction: 2 })).toBe(6);
    expect(secondsAtPick(times, { segmentIndex: 3, fraction: 0 })).toBeNull();
    expect(secondsAtPick(null, { segmentIndex: 0, fraction: 0 })).toBeNull();
  });
});
