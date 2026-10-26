import { describe, expect, it } from 'vitest';
import { grblDriver, grblHalDriver } from '../../core/controllers';
import { parseStatusReport, type StatusReport } from '../../core/controllers/grbl';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl/parse-settings';
import type { LaserState } from './laser-store';
import {
  probeCircuitBlockReason,
  probeCircuitCheck,
  probeTestTouchPatch,
  type ProbeTestTouch,
} from './probe-test-touch';

const CLOSED = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Pn:P>') as StatusReport;
const OPEN = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>') as StatusReport;

type CircuitFixture = Pick<
  LaserState,
  | 'statusReport'
  | 'controllerSessionEpoch'
  | 'probeBusy'
  | 'streamer'
  | 'capabilities'
  | 'controllerSettings'
> & { readonly probeTestTouch?: ProbeTestTouch | null };

function circuit(overrides: Partial<CircuitFixture> = {}): CircuitFixture {
  return {
    statusReport: OPEN,
    controllerSessionEpoch: 3,
    probeBusy: false,
    streamer: null,
    capabilities: grblDriver.capabilities,
    controllerSettings: null,
    probeTestTouch: null,
    ...overrides,
  };
}

const TOUCHED = { probeTestTouch: { controllerSessionEpoch: 3 } };

describe('probeTestTouchPatch', () => {
  it('records a closed probe input as this session’s test touch', () => {
    expect(probeTestTouchPatch(circuit(), CLOSED)).toEqual(TOUCHED);
    expect(probeTestTouchPatch(circuit(), OPEN)).toEqual({});
  });

  it('ignores the contacts a probe cycle makes itself', () => {
    expect(probeTestTouchPatch(circuit({ probeBusy: true }), CLOSED)).toEqual({});
  });

  it('voids the touch while a job streams, since the lead comes off for the cut', () => {
    const streaming = { status: 'streaming' } as LaserState['streamer'];
    expect(probeTestTouchPatch(circuit({ ...TOUCHED, streamer: streaming }), CLOSED)).toEqual({
      probeTestTouch: null,
    });
  });

  it('keeps counting during a tool-change hold, where the new bit is touched off', () => {
    const held = { status: 'tool-change' } as LaserState['streamer'];
    expect(probeTestTouchPatch(circuit({ streamer: held }), CLOSED)).toEqual(TOUCHED);
  });
});

describe('probeCircuitCheck and its block reason', () => {
  it('is tested only after a touch in this session with the input open again', () => {
    expect(probeCircuitCheck(circuit())).toBe('untested');
    expect(probeCircuitCheck(circuit({ ...TOUCHED, statusReport: CLOSED }))).toBe('closed');
    expect(probeCircuitCheck(circuit(TOUCHED))).toBe('tested');
    expect(probeCircuitCheck(circuit({ probeTestTouch: { controllerSessionEpoch: 2 } }))).toBe(
      'untested',
    );
    expect(probeCircuitBlockReason(circuit(TOUCHED))).toBeNull();
  });

  it('names the $10 to send when grblHAL leaves pin state out of its reports', () => {
    const settings = {
      statusReportMask: 495,
      statusReportMaskIsFull: true,
    } as ControllerSettingsSnapshot;
    const reason = probeCircuitBlockReason(
      circuit({ capabilities: grblHalDriver.capabilities, controllerSettings: settings }),
    );
    expect(reason).toContain('Test the probe first');
    expect(reason).toContain("This grblHAL's $10=495");
    expect(reason).toContain('send $10=511');
    const reporting = {
      statusReportMask: 511,
      statusReportMaskIsFull: true,
    } as ControllerSettingsSnapshot;
    expect(
      probeCircuitBlockReason(
        circuit({ capabilities: grblHalDriver.capabilities, controllerSettings: reporting }),
      ),
    ).not.toContain('$10');
  });
});
