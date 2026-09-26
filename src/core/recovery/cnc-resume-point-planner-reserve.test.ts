// OR-2 (2026-09-25 controller audit): CNC pass recovery never labels a pass
// proven complete while it may still have been queued. Adapted from the audit's
// reproduction test.
//
// A controller acknowledges a line once it is parsed into the planner, not once
// it has moved (GRBL 1.1h motion_control.c:57-68, protocol.c:104), so the
// rewind must cover the planner the controller can actually have:
//  - grblHAL core d7aaee3d settings.c:2485 `Setting_PlannerBlocks ... "30",
//    "1000"` (default 100, config.h:906; planner.c:230 sizes the planner);
//  - FluidNC v4.0.3 Machine/MachineConfig.cpp:89
//    `handler.item("planner_blocks", _planner_blocks, 10, 120);`.

import { describe, expect, it } from 'vitest';
import { isSendableGcodeLine } from '../controllers/grbl';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from '../devices';
import type { CncGroup, CncPass, Job } from '../job';
import { emitCncJobWithPassSpans } from '../output';
import { cncResumePlannerReserveLines, resolveCncResumePoint } from './cnc-resume-point';

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
const sendableTotal = rawLines.filter(isSendableGcodeLine).length;

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

/** Passes labelled proven although a controller with `plannerBlocks` blocks
 *  could still have held one of their lines when the job stopped. */
function provenPassesThatMayNotHaveRun(args: {
  readonly controllerKind: ControllerKind;
  readonly actualPlannerBlocks: number;
  readonly recordedPlannerBlocks?: number;
  readonly acked: number;
}): string[] {
  const point = resolveCncResumePoint({
    gcode,
    ackedLines: args.acked,
    spans,
    controllerKind: args.controllerKind,
    streamingMode: 'char-counted',
    rxBufferBytes: 1024,
    plannerBlocks: args.recordedPlannerBlocks,
  });
  if (point.kind !== 'resume-at-pass') throw new Error(point.kind);
  // With that many motion blocks still queued, the first line that may not
  // have moved is that many motion lines before the acknowledged frontier.
  const mayNotHaveRunRaw = rawOfSendable(args.acked - args.actualPlannerBlocks + 1);
  return spans
    .slice(0, point.provenCompletePassCount)
    .filter((span) => span.lastRawLine >= mayNotHaveRunRaw)
    .map((span) => `pass ${span.passIndex + 1} (raw ${span.firstRawLine}-${span.lastRawLine})`);
}

describe('OR-2: CNC pass recovery never labels a queued pass proven', () => {
  it('grblHAL with $398=400 and no recorded planner size (valid range 30..1000)', () => {
    const acked = sendableTotal - 10;
    expect(
      provenPassesThatMayNotHaveRun({ controllerKind: 'grblhal', actualPlannerBlocks: 400, acked }),
    ).toEqual([]);
  });

  it('FluidNC with planner_blocks: 120 and no recorded planner size (valid range 10..120)', () => {
    const acked = sendableTotal - 10;
    expect(
      provenPassesThatMayNotHaveRun({ controllerKind: 'fluidnc', actualPlannerBlocks: 120, acked }),
    ).toEqual([]);
  });

  it('a recorded planner size bounds the rewind and still proves the early passes', () => {
    const acked = sendableTotal - 10;
    expect(
      provenPassesThatMayNotHaveRun({
        controllerKind: 'grblhal',
        actualPlannerBlocks: 400,
        recordedPlannerBlocks: 400,
        acked,
      }),
    ).toEqual([]);
    const point = resolveCncResumePoint({
      gcode,
      ackedLines: acked,
      spans,
      controllerKind: 'grblhal',
      streamingMode: 'char-counted',
      rxBufferBytes: 1024,
      plannerBlocks: 400,
    });
    expect(point.kind === 'resume-at-pass' && point.provenCompletePassCount).toBeGreaterThan(0);
  });
});

describe('cncResumePlannerReserveLines', () => {
  it('uses the firmware maximum plus its segment buffer when nothing was recorded', () => {
    // grblHAL: 1000 blocks (settings.c:2485) + SEGMENT_BUFFER_SIZE 10 (config.h:392).
    expect(cncResumePlannerReserveLines('grblhal', undefined)).toBe(1010);
    // FluidNC: 120 blocks (MachineConfig.cpp:89) + up to 20 segments (Stepping.cpp:216).
    expect(cncResumePlannerReserveLines('fluidnc', undefined)).toBe(140);
    // Stock GRBL: 15 usable blocks + 6 segments, with the historical margin.
    expect(cncResumePlannerReserveLines('grbl-v1.1', undefined)).toBe(32);
  });

  it('takes the larger of the historical floor and the recorded size plus segments', () => {
    // The Falcon A1 Pro's reported `Bf:512` (falcon-profiles.ts).
    expect(cncResumePlannerReserveLines('grblhal', 512)).toBe(522);
    // grblHAL's default 100 blocks stays under the 256-line floor.
    expect(cncResumePlannerReserveLines('grblhal', 100)).toBe(256);
    expect(cncResumePlannerReserveLines('fluidnc', 120)).toBe(140);
    expect(cncResumePlannerReserveLines('grbl-v1.1', 35)).toBe(41);
  });

  it('ignores a recorded size that is not a positive number', () => {
    expect(cncResumePlannerReserveLines('grblhal', 0)).toBe(1010);
    expect(cncResumePlannerReserveLines('grblhal', Number.NaN)).toBe(1010);
  });
});
