// Probe circuit test touch before touch-off (meta audit M7-P2-1, the
// 2026-09-24 CNC audit's MC-2; ADR-103 Amendment 2).
//
// The touch-off cycle's first G38.2 seeks the whole Max travel down at the
// seek feed (probe.ts). GRBL stops it only on contact, or with ALARM:5 at the
// end of that travel, so a lead that was never clipped on, or a broken one,
// drives the bit into the plate and the stock. Peer senders prove the circuit
// first. gSender keeps Start Probe disabled, "Waiting for probe circuit
// check...", until a status report shows the probe pin, after asking the
// operator to lift the plate to the tool:
// https://github.com/Sienci-Labs/gsender/blob/426eaa1925c8ba4616882d297bb1ef2ae20652da/src/app/src/features/Probe/RunProbe.tsx#L160-L187
//
// GRBL, grblHAL and FluidNC report a closed probe input as `Pn:P` and leave
// `Pn:` out while no input is active, so once a touch has shown the input
// reports at all, a report without `P` means the circuit is open again.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L567-L573
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L1409-L1436
// https://github.com/bdring/FluidNC/blob/c82d217cad69fa937d57cee24fcf7ce9080fba05/FluidNC/src/Report.cpp#L467-L468
//
// So each touch-off needs one test touch in this controller session: a status
// report with the probe input closed, seen while no probe cycle or stream
// runs, and the input open again when the cycle starts. Starting a cycle uses
// the touch up, so a retry after a failed probe asks for a new one, and a job
// streamed in between voids it (the lead comes off for the cut).

import type { StatusReport } from '../../core/controllers/grbl';
import { pinStateReportOff } from '../../core/controllers/grblhal/status-report-mask';
import type { LaserState } from './laser-store';

export type ProbeTestTouch = { readonly controllerSessionEpoch: number };

/** What the probe circuit shows: no test touch yet, closed now, or tested. */
export type ProbeCircuitCheck = 'untested' | 'closed' | 'tested';

type CircuitState = Pick<
  LaserState,
  'statusReport' | 'controllerSessionEpoch' | 'probeBusy' | 'streamer'
> & { readonly probeTestTouch?: ProbeTestTouch | null };

/** Records a test touch from a status report, or voids it while a job streams. */
export function probeTestTouchPatch(
  state: CircuitState,
  report: StatusReport,
): Partial<LaserState> {
  if (state.streamer?.status === 'streaming') {
    return state.probeTestTouch == null ? {} : { probeTestTouch: null };
  }
  // A probe cycle's own contacts are not a test of the lead.
  if (state.probeBusy || report.pins?.probe !== true || hasCurrentTouch(state)) return {};
  return { probeTestTouch: { controllerSessionEpoch: state.controllerSessionEpoch } };
}

export function probeCircuitCheck(state: CircuitState): ProbeCircuitCheck {
  if (state.statusReport?.pins?.probe === true) return 'closed';
  return hasCurrentTouch(state) ? 'tested' : 'untested';
}

/** Why the touch-off cycle may not seek yet, or null once the circuit is tested. */
export function probeCircuitBlockReason(
  state: CircuitState & Pick<LaserState, 'capabilities' | 'controllerSettings'>,
): string | null {
  switch (probeCircuitCheck(state)) {
    case 'tested':
      return null;
    case 'closed':
      return (
        'The probe input is closed. Take the touch plate away from the bit before probing. If ' +
        'it stays closed with nothing touching, check the probe lead for a short and whether ' +
        'the probe input is inverted ($6 on GRBL and grblHAL).'
      );
    case 'untested':
      return `${UNTESTED_REASON}${pinStateHint(state)}`;
  }
}

const UNTESTED_REASON =
  'Test the probe first: hold the plate against the bit until the probe input shows closed, ' +
  'then take it away. The probe seeks down until it touches, so a lead that is not clipped on ' +
  'drives the bit into the plate.';

function pinStateHint(state: Pick<LaserState, 'capabilities' | 'controllerSettings'>): string {
  const off = pinStateReportOff(state.capabilities, state.controllerSettings);
  return off === null
    ? ''
    : ` This grblHAL's $10=${off.mask} leaves the probe input out of status reports; send ` +
        `$10=${off.suggestedMask} so the touch can show.`;
}

function hasCurrentTouch(state: CircuitState): boolean {
  return state.probeTestTouch?.controllerSessionEpoch === state.controllerSessionEpoch;
}
