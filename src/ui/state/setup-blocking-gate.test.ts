// CNC-03 — the setup-motion gate. During a tool-change hold the operator must
// jog/probe/Zero-Z to touch off the new bit, but ONLY once the machine drains
// the pre-M0 retract/park and reports Idle. Start / Home / Setup keep the
// strict block, so Start never unblocks at a tool change.
import { describe, expect, it } from 'vitest';
import { createStreamer, step, type StatusReport } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  TOOL_CHANGE_NOT_IDLE_MESSAGE,
  activeJobCommandBlockMessage,
  jogFrameCommandBlockMessage,
  setupBlockingJobCommandBlockMessage,
  setupCommandBlockMessage,
} from './laser-store-helpers';

const MULTI_TOOL = ['G1 X10 Y10 F800', 'G0 Z5', 'M5', 'G0 X0 Y0', 'M0', 'M3 S12000'].join('\n');

function toolChangeStreamer(): LaserState['streamer'] {
  const s = step(createStreamer(MULTI_TOOL, { toolChangePause: true })).state;
  if (s.status !== 'tool-change') throw new Error(`expected tool-change, got ${s.status}`);
  return s;
}
function streamingStreamer(): LaserState['streamer'] {
  return step(createStreamer('G1 X1 S100')).state;
}
function statusReport(state: StatusReport['state']): StatusReport {
  return { state, subState: null, mPos: { x: 0, y: 0, z: 0 }, wPos: null, feed: 0, spindle: 0, wco: null };
}
// The gates read only these fields; a partial cast keeps the test focused.
function gateState(partial: Partial<LaserState>): LaserState {
  return { motionOperation: null, controllerOperation: null, ...partial } as LaserState;
}

describe('setupBlockingJobCommandBlockMessage (CNC-03)', () => {
  it('blocks setup motion during a normal streaming job', () => {
    const s = gateState({ streamer: streamingStreamer(), statusReport: null });
    expect(setupBlockingJobCommandBlockMessage(s)).toBe(ACTIVE_JOB_COMMAND_MESSAGE);
  });

  it('permits setup motion during a tool-change hold once the machine is Idle', () => {
    const s = gateState({ streamer: toolChangeStreamer(), statusReport: statusReport('Idle') });
    expect(setupBlockingJobCommandBlockMessage(s)).toBeNull();
  });

  it('blocks setup motion during a tool-change hold until the machine reports Idle', () => {
    const running = gateState({ streamer: toolChangeStreamer(), statusReport: statusReport('Run') });
    expect(setupBlockingJobCommandBlockMessage(running)).toBe(TOOL_CHANGE_NOT_IDLE_MESSAGE);
    const unknown = gateState({ streamer: toolChangeStreamer(), statusReport: null });
    expect(setupBlockingJobCommandBlockMessage(unknown)).toBe(TOOL_CHANGE_NOT_IDLE_MESSAGE);
  });

  it('does not block when there is no active job', () => {
    expect(setupBlockingJobCommandBlockMessage(gateState({ streamer: null, statusReport: null }))).toBeNull();
  });

  it('lets jog fall through to allowed during a settled tool change', () => {
    const s = gateState({ streamer: toolChangeStreamer(), statusReport: statusReport('Idle') });
    expect(jogFrameCommandBlockMessage(s)).toBeNull();
  });

  it('KEEPS Start blocked during a tool change — Start must never unblock', () => {
    // setupCommandBlockMessage backs assertStartAllowed, and it uses the STRICT
    // activeJobCommandBlockMessage, so a settled tool-change still blocks Start.
    const s = gateState({ streamer: toolChangeStreamer(), statusReport: statusReport('Idle') });
    expect(activeJobCommandBlockMessage(s)).toBe(ACTIVE_JOB_COMMAND_MESSAGE);
    expect(setupCommandBlockMessage(s)).toBe(ACTIVE_JOB_COMMAND_MESSAGE);
  });
});
