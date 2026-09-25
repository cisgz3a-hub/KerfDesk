// Audit track CN (2026-09-25) — what a CNC operator on a Marlin or
// Smoothieware profile is told when they try to Frame.
//
// Correct behaviour: the ordinary CNC Frame is dialog-free (use-frame-action.ts:
// "the single Job Review runs at Start") and Start stays disabled until a clean
// Frame (ADR-372), so the Frame refusal is the only message this operator sees.
// It must name the real, unfixable reason — this controller cannot run KerfDesk
// CNC jobs (driver.capabilities.cncJobs === false; CNC_REQUIRES_GRBL_MESSAGE) —
// and must not first send the operator to set Work Z zero for a Frame that can
// never be built. This is the SAME refusal the code already makes (no retract
// builder => blocked); only its order and wording change. No new gate.
//
// Upstream fact behind the refusal: Marlin reads the CNC program's `G4 P3.000`
// spin-up dwell as 3 ms (Marlin 2.1.2.8 gcode/motion/G4.cpp:33,
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/motion/G4.cpp#L33).
//
// Expected result on current code: the two "correct behaviour" tests FAIL.

import { describe, expect, it } from 'vitest';

import { marlinDriver } from '../../core/controllers/marlin/driver';
import { smoothiewareDriver } from '../../core/controllers/smoothieware/driver';
import { deviceSupportsMachineKind } from '../../core/devices/device-profile';
import {
  buildCncFrameMotion,
  CNC_FRAME_RETRACT_UNSUPPORTED_MESSAGE,
  CNC_FRAME_WORK_Z_REQUIRED_MESSAGE,
} from '../../ui/state/cnc-frame-lines';

const PERIMETER = ['G90 G0 X10 Y10\n', 'G90 G0 X60 Y10\n'];

describe('CN: CNC Frame on a controller with cncJobs === false', () => {
  it.each([marlinDriver, smoothiewareDriver])(
    '$label has no CNC retract builder and does not accept CNC jobs (fact)',
    (driver) => {
      expect(driver.capabilities.cncJobs).toBe(false);
      expect(driver.commands.buildFrameRetract).toBeUndefined();
    },
  );

  it('today the refusal with Work Z set is about a missing retract, not controller support', () => {
    const plan = buildCncFrameMotion({
      perimeter: PERIMETER,
      safeZMm: 3.81,
      preFrameWorkZMm: 0,
      hasCurrentWorkZEvidence: true,
      buildRetract: marlinDriver.commands.buildFrameRetract,
      zFeed: 600,
    });
    expect(plan).toEqual({ kind: 'blocked', message: CNC_FRAME_RETRACT_UNSUPPORTED_MESSAGE });
  });

  it('correct: without Work Z the operator is not sent to zero Z first (FAILS on current code)', () => {
    const plan = buildCncFrameMotion({
      perimeter: PERIMETER,
      safeZMm: 3.81,
      preFrameWorkZMm: null,
      hasCurrentWorkZEvidence: false,
      buildRetract: marlinDriver.commands.buildFrameRetract,
      zFeed: 600,
    });
    expect(plan.kind).toBe('blocked');
    // Today: CNC_FRAME_WORK_Z_REQUIRED_MESSAGE ("Zero Z or run a settled probe,
    // then Frame again") — advice that cannot make this Frame possible.
    if (plan.kind === 'blocked') expect(plan.message).not.toBe(CNC_FRAME_WORK_Z_REQUIRED_MESSAGE);
  });

  it('correct: the refusal names the GRBL-family requirement (FAILS on current code)', () => {
    const plan = buildCncFrameMotion({
      perimeter: PERIMETER,
      safeZMm: 3.81,
      preFrameWorkZMm: 0,
      hasCurrentWorkZEvidence: true,
      buildRetract: smoothiewareDriver.commands.buildFrameRetract,
      zFeed: 600,
    });
    expect(plan.kind).toBe('blocked');
    if (plan.kind === 'blocked') expect(plan.message).toMatch(/GRBL-family/);
  });

  it('the Laser|CNC toggle raises no warning for an unlabelled Marlin profile (fact)', () => {
    // MachineModeToggle.tsx:16-20 only warns when the profile's capability label
    // excludes CNC; a custom/imported Marlin profile without labels gets nothing.
    expect(deviceSupportsMachineKind({ capabilities: [] }, 'cnc')).toBe(true);
    expect(deviceSupportsMachineKind({}, 'cnc')).toBe(true);
  });
});
