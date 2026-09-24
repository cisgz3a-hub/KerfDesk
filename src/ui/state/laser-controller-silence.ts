// laser-controller-silence — what a connect handshake that heard nothing
// reports. Split from laser-controller-handshake at the 400-line cap.

import {
  awaitPolledQualification,
  failedControllerQualificationPatch,
  POLLED_RESPONSE_TIMEOUT_MS,
} from './laser-controller-qualification';
import type { SetFn, GetFn } from './laser-line-shared';
import type { LiveRefs } from './laser-store';
import { appendSystemNotice } from './laser-system-notice';

type SilentSession = { readonly baudRate: number; readonly epoch: number };

/** A queued-poll driver was sent nothing yet, so its first status poll decides
 *  (awaitPolledQualification, audit connect-5); any other driver ignored the
 *  status query the handshake sent within `handshakeWindowMs`. */
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
  if (driver.realtime.statusQuery === null && driver.commands.queuedStatusQuery !== null) {
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
  set(
    appendSystemNotice(
      get(),
      refs,
      `[lf2] No controller response within ${waitedMs / 1000} s. Check baud rate (${baudRate}) and that the device is ${refs.driver.label}.`,
    ),
  );
  set((state) =>
    failedControllerQualificationPatch(
      state,
      epoch,
      `No controller response was received at ${baudRate} baud. Check the cable and controller profile, then retry.`,
    ),
  );
}
