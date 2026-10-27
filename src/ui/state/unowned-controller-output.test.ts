// Rolling audit v5 J2-P2-1: which reports count as a laser left on at Idle with
// nothing in KerfDesk running it (ADR-375 Amendment 9).

import { describe, expect, it } from 'vitest';
import { createStreamer, parseStatusReport, step } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { statusPositionPatch } from './laser-status-position';
import { outputOffCommand, unownedControllerOutput } from './unowned-controller-output';

function reported(wire: string, patch: Partial<LaserState> = {}): LaserState {
  const report = parseStatusReport(wire);
  if (report === null) throw new Error(`bad fixture ${wire}`);
  const state = {
    ...initialLaserState(),
    connection: { kind: 'connected' },
    ...patch,
  } as LaserState;
  return { ...state, ...statusPositionPatch(state, report) } as LaserState;
}

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100';

describe('unownedControllerOutput', () => {
  it.each([
    ['A:S', 'laser', 'M5'],
    ['A:C', 'laser', 'M5'],
    ['A:SF', 'laser-and-air', 'M5 M9'],
    ['A:SM', 'laser-and-air', 'M5 M9'],
  ] as const)('reads %s at Idle as %s, turned off with %s', (field, output, command) => {
    const found = unownedControllerOutput(reported(`${IDLE}|${field}>`), 'laser');
    expect(found).toBe(output);
    expect(found === null ? null : outputOffCommand(found)).toBe(command);
  });

  it('ignores air alone and a report with no accessories on', () => {
    expect(unownedControllerOutput(reported(`${IDLE}|A:F>`), 'laser')).toBeNull();
    expect(unownedControllerOutput(reported(`${IDLE}>`), 'laser')).toBeNull();
  });

  it('keeps the report between the frames GRBL sends without A:', () => {
    const lit = reported(`${IDLE}|A:S>`);
    const next = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    if (next === null) throw new Error('bad fixture');
    expect(unownedControllerOutput({ ...lit, ...statusPositionPatch(lit, next) }, 'laser')).toBe(
      'laser',
    );
  });

  it('leaves a CNC spindle to Stop spindle & coolant', () => {
    expect(unownedControllerOutput(reported(`${IDLE}|A:S>`), 'cnc')).toBeNull();
  });

  it('leaves the output to whatever here owns it', () => {
    const owners: ReadonlyArray<Partial<LaserState>> = [
      { fireActive: true },
      { streamer: step(createStreamer('G1 X1 S100')).state },
      { motionOperation: { kind: 'jog' } as LaserState['motionOperation'] },
      { controllerOperation: { kind: 'home' } as LaserState['controllerOperation'] },
    ];
    for (const owner of owners) {
      expect(unownedControllerOutput(reported(`${IDLE}|A:S>`, owner), 'laser')).toBeNull();
    }
  });

  it('counts only Idle on a connected controller', () => {
    const running = reported('<Run|MPos:0.000,0.000,0.000|FS:500,0|Ov:100,100,100|A:S>');
    expect(unownedControllerOutput(running, 'laser')).toBeNull();
    const closed = { ...reported(`${IDLE}|A:S>`), connection: { kind: 'disconnected' } };
    expect(unownedControllerOutput(closed as LaserState, 'laser')).toBeNull();
  });
});
