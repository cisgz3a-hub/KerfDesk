import type { PreflightContext, PreflightResult } from '../PreflightContext';
import { PREFLIGHT_CODES } from '../PreflightContext';

export function runMachineStateChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  if (ctx.connectedToMachine === false) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_DISCONNECTED,
      message: 'Not connected to a machine. Connect to a laser or use the simulator.',
    });
  }

  if (ctx.connectedToMachine === true && ctx.machineStatus == null) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_DISCONNECTED,
      message: 'Not connected to a machine',
    });
  }

  const st = ctx.machineStatus;
  if (st == null) return;

  if (st === 'alarm') {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_ALARM,
      message: `Machine in ALARM state${ctx.machineAlarmCode != null ? ` (code ${ctx.machineAlarmCode})` : ''}. Unlock with $X before starting.`,
    });
  }
  if (st === 'faulted_requires_inspection') {
    // T2-12 part 2: software-synthesized state after a job-stopping
    // error. Distinct from 'alarm' both in semantic (uncertainty about
    // machine state, not a clean alarm condition) and in recovery
    // path ("acknowledge fault" not "$X to clear").
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_FAULTED,
      message: 'Machine fault detected. Inspect the workpiece and machine, then acknowledge before starting a new job.',
    });
  }
  if (st === 'hold') {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_HOLD,
      message: 'Machine is paused. Resume or stop before starting a new job.',
    });
  }
  if (st === 'door') {
    // T1-followup-safety-door: GRBL `<Door|...>` reports the safety
    // interlock is active (door open, e-stop pressed, lid switch
    // tripped, etc). Pre-fix this state fell through to the
    // MACHINE_NOT_IDLE warning bucket — start was technically
    // discouraged but not blocked. Now blocked: no job, frame, jog,
    // or test-fire can begin while the interlock is open.
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_DOOR,
      message: 'Safety door / interlock is active. Close the door or release the e-stop, then wait for the controller to return to idle before starting a job.',
    });
  }
  if (st === 'run') {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_RUNNING,
      message: 'A job is already running. Wait for it to finish or stop it.',
    });
  }
  if (st === 'homing') {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.MACHINE_HOMING,
      message: 'Machine is homing. Wait for homing to complete.',
    });
  }
  if (
    st !== 'idle' &&
    st !== 'alarm' &&
    st !== 'faulted_requires_inspection' &&
    st !== 'hold' &&
    st !== 'door' &&
    st !== 'run' &&
    st !== 'homing'
  ) {
    out.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.MACHINE_NOT_IDLE,
      message: `Machine state is ${st}. Expected idle when starting a job.`,
    });
  }
  if (
    ctx.connectedToMachine === true &&
    !ctx.hasGcode &&
    st === 'idle' &&
    !ctx.machinePlanBounds
  ) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.NO_GCODE,
      message: 'No G-code compiled. Update the design or recompile.',
    });
  }
}
