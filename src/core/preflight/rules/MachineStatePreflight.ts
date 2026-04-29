import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';

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
