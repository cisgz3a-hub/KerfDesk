// laser-reset-alarm — the ALARM:N a controller reset itself raised (controller
// audit streaming-4). GRBL and grblHAL report an Abort during motion as
// `ALARM:3` (`ALARM:6` while homing) and only then print the reboot banner and
// the `'$H'|'$X' to unlock` message: protocol_exec_rt_system reports the alarm
// and returns on EXEC_RESET before it can answer a status query. The banner
// handler resets every session value, so it used to drop that code and the
// Alarm banner and Start readiness showed a generic Alarm instead of "reset
// while in motion".
//
// The code survives the banner only when no status report came between them.
// A status report proves the controller kept running after that alarm, so a
// later banner is a different reboot (a power cycle, or a reset sent after a
// hard limit) and starts clean, as before.

//
// A banner also says nothing about why the controller rebooted. A soft reset
// KerfDesk wrote keeps the machine position; a power-up clears it. The Reset
// and Wake buttons write theirs outside the reset transaction that
// awaitsOwnedResetBoundary knows, and their recovery operation can end before
// the banner arrives (a status report in Alarm ends it), so the write itself
// is noted here and the next banner within a few seconds answers it
// (ADR-367 Amendment 3).

import { alarmAcrossBannerPatch } from './position-kept-alarm';

export type ResetAlarmRefs = {
  /** The last ALARM:N that no status report has followed yet. */
  alarmBeforeBanner?: number | null;
  /** When KerfDesk last wrote a soft reset that no banner has answered yet. */
  ownResetWrittenAt?: number | null;
};

// GRBL-family firmware prints its banner within milliseconds of Ctrl-X. A
// banner later than this is not taken for the answer.
const OWN_RESET_BANNER_WINDOW_MS = 10_000;

/** Called for every transport write, before it is awaited: the banner can
 *  arrive before the write promise settles. */
export function noteOwnResetWrite(
  refs: ResetAlarmRefs,
  data: string,
  softReset: string | null,
): void {
  if (softReset !== null && data === softReset) refs.ownResetWrittenAt = Date.now();
}

// Consumed, so a second banner is not taken for the same reset.
function takeOwnResetBeforeBanner(refs: ResetAlarmRefs): boolean {
  const writtenAt = refs.ownResetWrittenAt ?? null;
  refs.ownResetWrittenAt = null;
  return writtenAt !== null && Date.now() - writtenAt <= OWN_RESET_BANNER_WINDOW_MS;
}

export function noteAlarmBeforeBanner(refs: ResetAlarmRefs, code: number): void {
  refs.alarmBeforeBanner = code;
}

export function forgetAlarmBeforeBanner(refs: ResetAlarmRefs): void {
  refs.alarmBeforeBanner = null;
}

/** The alarm code a reboot banner keeps. Consumed, so a later banner starts clean. */
export function takeAlarmBeforeBanner(refs: ResetAlarmRefs): number | null {
  const code = refs.alarmBeforeBanner ?? null;
  refs.alarmBeforeBanner = null;
  return code;
}

/** The alarm on record after a reboot banner: the code above, or a
 *  position-kept alarm that asked for the reset KerfDesk then sent, and the
 *  record of how it was raised when the banner answers KerfDesk's own reset
 *  (position-kept-alarm.ts, ADR-367 Amendment 3). `ownedReset`: the reset
 *  transaction of Abort or Disconnect awaits this banner. */
export function alarmAfterBannerPatch(
  refs: ResetAlarmRefs,
  state: Parameters<typeof alarmAcrossBannerPatch>[0],
  ownedReset: boolean,
): ReturnType<typeof alarmAcrossBannerPatch> {
  const wroteReset = takeOwnResetBeforeBanner(refs);
  return alarmAcrossBannerPatch(state, takeAlarmBeforeBanner(refs), wroteReset || ownedReset);
}
