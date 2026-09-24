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

export type ResetAlarmRefs = {
  /** The last ALARM:N that no status report has followed yet. */
  alarmBeforeBanner?: number | null;
};

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
