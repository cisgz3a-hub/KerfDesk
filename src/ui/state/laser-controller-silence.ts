// laser-controller-silence — what a connect handshake that heard nothing
// reports. Split from laser-controller-handshake at the 400-line cap.

import {
  awaitPolledQualification,
  failedControllerQualificationPatch,
  POLLED_RESPONSE_TIMEOUT_MS,
} from './laser-controller-qualification';
import type { SetFn, GetFn } from './laser-line-shared';
import type { LaserState, LiveRefs } from './laser-store';
import { sessionSawLineError } from './laser-serial-line-errors';
import { appendSystemNotice } from './laser-system-notice';

type SilentSession = { readonly baudRate: number; readonly epoch: number };
type InboundEvidence = 'none' | 'undecodable' | 'readable';

/** Silence within `handshakeWindowMs` is not yet a fault. A driver with a
 *  realtime status query asked and heard nothing, but a board that resets on
 *  open prints its banner only after its whole start-up
 *  (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L102),
 *  and a slow one used to be reported as a baud-rate problem it did not have,
 *  and Find my machine offered other speeds (controller audit T-4, ADR-375).
 *  It keeps listening, as the status poll keeps asking, for 10 s in all, as
 *  LaserGRBL does before it gives up
 *  (https://github.com/arkypita/LaserGRBL/blob/1f9337b3af27133f8b1696e41cc110f2af74d04f/LaserGRBL/Core/GrblCore.cs#L2029).
 *  A queued-poll driver was sent nothing yet, so its first status poll decides
 *  (awaitPolledQualification, audit connect-5). */
export function reportSilentController(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  connection: NonNullable<LiveRefs['connection']>,
  session: SilentSession,
  handshakeWindowMs: number,
): void {
  const report = (waitedMs: number): void =>
    reportMissingControllerResponse(set, get, refs, session, waitedMs);
  const driver = refs.driver;
  if (driver.realtime.statusQuery !== null) {
    set(
      appendSystemNotice(
        get(),
        refs,
        `[lf2] No controller response within ${handshakeWindowMs / 1000} s. Still listening: a controller can take several seconds to start after the port opens.`,
      ),
    );
    awaitPolledQualification(set, get, refs, connection, session.epoch, () =>
      report(handshakeWindowMs + POLLED_RESPONSE_TIMEOUT_MS),
    );
    return;
  }
  if (driver.commands.queuedStatusQuery !== null) {
    awaitPolledQualification(set, get, refs, connection, session.epoch, () =>
      report(POLLED_RESPONSE_TIMEOUT_MS),
    );
    return;
  }
  report(handshakeWindowMs);
}

function reportMissingControllerResponse(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  session: SilentSession,
  waitedMs: number,
): void {
  const { baudRate, epoch } = session;
  const evidence = inboundEvidence(get(), refs);
  const [notice, failure] = silenceMessages(evidence, waitedMs / 1000, baudRate, refs.driver.label);
  set(appendSystemNotice(get(), refs, notice));
  set((state) => failedControllerQualificationPatch(state, epoch, failure));
}

// Only a controller that sent nothing at all, or nothing that decodes, points
// at the baud rate. Lines that read as text mean the link and its speed work.
function silenceMessages(
  evidence: InboundEvidence,
  seconds: number,
  baudRate: number,
  device: string,
): readonly [notice: string, failure: string] {
  if (evidence === 'readable') {
    return [
      `[lf2] The controller sent data but no status report within ${seconds} s. Check that the device is ${device}.`,
      'The controller did not answer the status query. Check the controller profile, then retry.',
    ];
  }
  if (evidence === 'undecodable') {
    return [
      `[lf2] Only undecodable data from the controller within ${seconds} s. Check baud rate (${baudRate}) and that the device is ${device}.`,
      `The controller's data could not be decoded at ${baudRate} baud. Check the baud rate and controller profile, then retry.`,
    ];
  }
  return [
    `[lf2] No controller response within ${seconds} s. Check baud rate (${baudRate}) and that the device is ${device}.`,
    `No controller response was received at ${baudRate} baud. Check the cable and controller profile, then retry.`,
  ];
}

// GRBL-family replies are lines of ASCII text
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L492).
// At the wrong baud rate the UART reports framing or parity errors
// (laser-serial-line-errors.ts) or delivers other bytes, which the transport's
// non-fatal UTF-8 decoder turns into U+FFFD. Any recognised reply proves the
// speed; unrecognised lines prove it only when nothing in them failed to decode.
function inboundEvidence(state: LaserState, refs: LiveRefs): InboundEvidence {
  const inbound = state.transcript.filter(
    (entry) => entry.direction === 'in' && entry.raw.trim() !== '',
  );
  if (inbound.some((entry) => entry.kind !== 'unknown')) return 'readable';
  if (sessionSawLineError(refs, state)) return 'undecodable';
  if (inbound.length === 0) return 'none';
  return inbound.some((entry) => entry.raw.includes('\uFFFD')) ? 'undecodable' : 'readable';
}
