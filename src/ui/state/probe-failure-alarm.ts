// probe-failure-alarm: the alarms after which the machine position and the
// work origin still stand (controller audit 2 M-1, ADR-375).
//
// A failed probe, ALARM:4 (the probe already triggered, or on grblHAL is not
// connected) or ALARM:5 (no contact within the travel), stops only the probe
// move and resets nothing: GRBL and grblHAL do not count either as critical,
// and FluidNC only enters Alarm. Unlock (`$X`) then just returns to Idle, so
// the machine position and every work offset, a G92 included, still hold:
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L273-L298
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L223-L237
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L160-L165
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/alarms.h#L73-L80
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L447-L464
// https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/Protocol.cpp#L734-L764
// https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/ProcessSettings.cpp#L309-L329
//
// The other probe alarms stop motion outright and may lose steps, so they
// count as a reset like every other alarm. grblHAL's ALARM:13 (probe
// protection) halts a cycle or jog and marks the position lost if the motors
// were still stepping; FluidNC's ALARM:18 (probe hard limit) stops stepping at
// once, "possibly losing position":
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L568-L571
// https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/MotionControl.cpp#L439-L445

const PROBE_FAILURE_ALARM_CODES: ReadonlySet<number> = new Set([4, 5]);

/** ALARM:4/5: only the probe move stopped; position and work offsets hold. */
export function isProbeFailureAlarm(code: number | null | undefined): boolean {
  return code !== null && code !== undefined && PROBE_FAILURE_ALARM_CODES.has(code);
}
