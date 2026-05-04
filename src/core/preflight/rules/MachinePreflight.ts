import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';

export function runMachineChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const profile = ctx.profile;
  if (!profile?.maxSpindle) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MISSING_MAX_SPINDLE,
      message: 'Max spindle (S) unknown. Set it in Settings -> Machine.',
    });
  }

  if (profile?.accelAwarePower) {
    const hasAccel =
      (profile.maxAccelX ?? 0) > 0 ||
      (profile.maxAccelY ?? 0) > 0 ||
      (profile.maxAccelMmPerS2 ?? 0) > 0;
    if (!hasAccel) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.ACCEL_AWARE_NO_ACCEL_PARAM,
        message: 'Acceleration-aware power is enabled but no max acceleration is set.',
      });
    }
  }

  // T1-32: refuse jobs that emit M4 dynamic-mode against a controller reporting $32=0
  // (CNC / spindle mode). In CNC mode M4 keeps the laser on at full S between motion
  // commands, including stationary planner stalls between path segments — a fire / burn
  // hazard for diode lasers. The fix-it text points at $32=1; M3 constant-power is the
  // alternative for users who can't toggle $32.
  //
  // Skipped when:
  //   - controller is disconnected (laserMode === undefined): runtime preflight or
  //     post-connect handshake will surface it later
  //   - laserMode === true ($32=1): job is safe
  //   - hasGcode is false / no gcode to scan: nothing to check yet
  //   - gcode does not contain M4: the job uses M3 / no spindle command, $32 doesn't
  //     matter for the danger this rule guards against
  const liveLaserMode = ctx.liveMachineInfo?.laserMode;
  if (liveLaserMode === false && ctx.outputUsesM4) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_LASER_MODE_DISABLED,
      message:
        'Controller reports $32=0 (laser mode disabled) but this G-code uses M4 dynamic ' +
        'power. In CNC/spindle mode, M4 keeps the laser on at full S between motion ' +
        'commands. Send "$32=1" then reconnect, or switch to M3 constant-power output.',
    });
  }
}
