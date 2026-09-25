// Audit track OR, finding OR-2 (repro; expected to FAIL on current code).
//
// Correct behaviour: CNC pass recovery may mark a pass "proven complete" only
// when no line of it can still have been waiting in the controller's planner
// when the job stopped. A controller acknowledges a line once it is parsed into
// the planner, not once it has moved, so the rewind must cover the planner the
// controller can actually have.
//
// Upstream proof:
//  - grblHAL core (d7aaee3d84b1e7010f075d395206afff038d7379) settings.c:2485
//    `Setting_PlannerBlocks ... "Planner buffer blocks" ... "30", "1000"` and
//    settings.c:2261-2262 accept 30..1000 blocks; config.h:906 default 100;
//    planner.c:230 sizes the planner from that setting.
//  - FluidNC v4.0.3 Machine/MachineConfig.cpp:89
//    `handler.item("planner_blocks", _planner_blocks, 10, 120);` (default 16,
//    MachineConfig.h:98).
//  - GRBL 1.1h motion_control.c:57-62 blocks in mc_line until the planner has
//    room, and the `ok` is only sent after gc_execute_line returns, so every
//    acknowledged motion line holds one planner block until it runs.
// KerfDesk (cnc-resume-point.ts:38-45) rewinds a fixed 256 lines on grblHAL and
// 64 on FluidNC, so on a controller configured with a larger (valid) planner
// the passes it labels "proven-complete" (✓ in CncPassRecoveryWizard) can be
// passes that never ran, and the default resume starts a deeper pass on uncut
// material.

import { describe, expect, it } from 'vitest';
import { isSendableGcodeLine } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../../core/devices';
import type { CncGroup, CncPass, Job } from '../../core/job';
import { emitCncJobWithPassSpans } from '../../core/output';
import { resolveCncResumePoint } from '../../core/recovery/cnc-resume-point';

// 12 passes of 40 G1 lines each: every cut line is one planner block.
function pass(index: number): CncPass {
  return {
    kind: 'contour',
    zMm: -0.5 - index * 0.5,
    polyline: Array.from({ length: 41 }, (_, i) => ({ x: i * 2, y: index % 2 })),
    closed: false,
  };
}
const group: CncGroup = {
  kind: 'cnc',
  layerId: 'L1',
  color: '#ff0000',
  cutType: 'engrave',
  toolDiameterMm: 3.175,
  feedMmPerMin: 1000,
  plungeMmPerMin: 300,
  spindleRpm: 12000,
  spindleSpinupSec: 3,
  safeZMm: 3.81,
  passes: Array.from({ length: 12 }, (_, i) => pass(i)),
};
const job: Job = { groups: [group] };
const { gcode, spans } = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
const rawLines = gcode.split('\n');

/** Raw line number of the given 1-based sendable ordinal. */
function rawOfSendable(ordinal: number): number {
  let seen = 0;
  for (let i = 0; i < rawLines.length; i += 1) {
    if (!isSendableGcodeLine(rawLines[i] ?? '')) continue;
    seen += 1;
    if (seen === ordinal) return i + 1;
  }
  return rawLines.length;
}

function provenPassesThatMayNotHaveRun(controllerKind: ControllerKind, plannerBlocks: number) {
  const sendable = rawLines.filter(isSendableGcodeLine).length;
  const acked = sendable - 10;
  const point = resolveCncResumePoint({
    gcode,
    ackedLines: acked,
    spans,
    controllerKind,
    streamingMode: 'char-counted',
    rxBufferBytes: 1024,
  });
  if (point.kind !== 'resume-at-pass') throw new Error(point.kind);
  // With `plannerBlocks` motion blocks still queued, the first line that may
  // not have moved is `plannerBlocks` motion lines before the acked frontier.
  const mayNotHaveRunRaw = rawOfSendable(acked - plannerBlocks + 1);
  return spans
    .slice(0, point.provenCompletePassCount)
    .filter((span) => span.lastRawLine >= mayNotHaveRunRaw)
    .map((span) => `pass ${span.passIndex + 1} (raw ${span.firstRawLine}-${span.lastRawLine})`);
}

describe('OR-2: CNC pass recovery never labels a pass proven when it may still have been queued', () => {
  it('grblHAL with $398=400 planner blocks (valid range 30..1000)', () => {
    expect(provenPassesThatMayNotHaveRun('grblhal', 400)).toEqual([]);
  });

  it('FluidNC with planner_blocks: 120 (valid range 10..120)', () => {
    expect(provenPassesThatMayNotHaveRun('fluidnc', 120)).toEqual([]);
  });
});
