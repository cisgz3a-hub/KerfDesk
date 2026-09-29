// GRBL reports the machine position (MPos) or the work position (WPos), as $10
// selects, never both, and MPos = WPos + WCO, where WCO comes in only some
// reports. The head camera read only MPos, so a controller set to report WPos
// gave it no head position (controller audit R-5's gap, ADR-375). The status
// lines below go through the store's own status handling, as the controller
// sends them.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L522-L527
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L548-L552

import { afterEach, describe, expect, it } from 'vitest';
import { parseStatusReport } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { Vec2 } from '../../../core/scene';
import { makeLineHandlerHarness } from '../../state/laser-line-handler.test-support';
import { handleStatusLine } from '../../state/laser-status-line';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useLaserStore } from '../../state/laser-store';
import { stockNativeEvidence } from '../../state/native-bed-frame.test-support';
import { headPositionOnBed } from './head-position';

const DEVICE = {
  ...DEFAULT_DEVICE_PROFILE,
  bedWidth: 358,
  bedHeight: 268,
  homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
};

/** A homed stock GRBL connection whose bed mapping is verified. */
function connectHomed(reportInches = false): void {
  const evidence = stockNativeEvidence(DEVICE);
  useLaserStore.setState({
    ...initialLaserState(),
    ...evidence,
    controllerSettings: { ...evidence.controllerSettings, reportInches },
    connection: { kind: 'connected' },
    trustedPositionEpoch: 4,
  });
}

/** A status line from the controller, through the store's status handling. */
function receive(line: string): void {
  const report = parseStatusReport(line);
  if (report === null) throw new Error(`status line did not parse: ${line}`);
  const { refs } = makeLineHandlerHarness();
  handleStatusLine(
    useLaserStore.setState,
    useLaserStore.getState,
    refs,
    async () => undefined,
    report,
  );
}

function head(): Vec2 | null {
  return headPositionOnBed(DEVICE, useLaserStore.getState());
}

/** Where the head camera puts an MPos report of `x`, `y` millimetres. */
function headFromMPos(x: number, y: number): Vec2 | null {
  connectHomed();
  receive(`<Idle|MPos:${x.toFixed(3)},${y.toFixed(3)},0.000|FS:0,0>`);
  return head();
}

afterEach(() => {
  useLaserStore.setState(initialLaserState());
});

describe('head camera position from a controller that reports WPos', () => {
  it('places the head from WPos plus the work offset where the same MPos puts it', () => {
    const expected = headFromMPos(-300, -200);
    expect(expected).not.toBeNull();

    connectHomed();
    receive('<Idle|WPos:-310.000,-220.000,0.000|FS:0,0|WCO:10.000,20.000,0.000>');
    expect(useLaserStore.getState().statusReport?.mPos).toBeNull();
    expect(head()).toEqual(expected);

    // WCO comes in only some reports; the last one reported still applies.
    receive('<Idle|WPos:-310.000,-220.000,0.000|FS:0,0>');
    expect(head()).toEqual(expected);
  });

  it('has no head position from WPos until a work offset has been reported', () => {
    connectHomed();
    receive('<Idle|WPos:-310.000,-220.000,0.000|FS:0,0>');
    expect(head()).toBeNull();
  });

  it('converts an inch report once', () => {
    // WPos (-11, -7) in plus WCO (-1, -1) in is MPos (-12, -8) in: (-304.8, -203.2) mm.
    const expected = headFromMPos(-304.8, -203.2);
    if (expected === null) throw new Error('the MPos report should place the head');

    connectHomed(true);
    receive('<Idle|WPos:-11.0000,-7.0000,0.0000|FS:0,0|WCO:-1.0000,-1.0000,0.0000>');
    const fromWPos = head();
    if (fromWPos === null) throw new Error('the WPos report should place the head');
    expect(fromWPos.x).toBeCloseTo(expected.x, 6);
    expect(fromWPos.y).toBeCloseTo(expected.y, 6);
  });
});
