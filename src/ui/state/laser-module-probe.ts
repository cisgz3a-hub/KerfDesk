// laser-module-probe — qualification's check of the firmware's laser output
// module (controller audit SM-3, SM-2). A driver with a `laserModuleProbe`
// (Smoothieware: `M221` with no argument, core/controllers/smoothieware/
// laser-module.ts) gets one owned query per qualification. Its answer is
// connection evidence: the module cannot appear or disappear without a
// reboot, which on USB is a new connection and over UART re-runs this check
// after the boot banner.
//
// With no module the session driver drops the module's own commands (`fire
// off`), which nothing on the board would ever answer; test Fire is refused,
// and a laser job gets a Job Review warning (laser-module-readiness.ts).

import { selectControllerDriver, type ControllerDriver } from '../../core/controllers';
import type { LaserModuleEvidence } from '../../core/controllers/controller-driver';
import {
  startControllerCommand,
  type ControllerCommandKind,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { interactiveControllerOperation } from './laser-controller-operation';
import { qualifiedController } from './laser-controller-qualification';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

export type LaserModuleObservation = LaserModuleEvidence & {
  /** The lines the probe printed before its `ok` (bounded), for diagnostics. */
  readonly rawLines: ReadonlyArray<string>;
  readonly sessionEpoch: number;
};

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type ProbeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;
export type LaserModuleProbeRefs = ControllerLifecycleRefs & { driver: ControllerDriver };

const PROBE_TIMEOUT_MS = 2_000;
const MAX_RAW_LINES = 4;

/** Evidence that belongs to one connection: another board may be on the other
 *  end of the next one. The Frame push count (laser-frame-modal-restore.ts)
 *  resets with it. */
export function connectionScopedEvidenceReset(): Pick<
  LaserState,
  'laserModuleEvidence' | 'framePushesAwaitingPop'
> {
  return { laserModuleEvidence: null, framePushesAwaitingPop: 0 };
}

/** The live connection's laser-module evidence, or null while disconnected or
 *  unprobed. */
export function connectedLaserModuleEvidence(
  state: Pick<LaserState, 'connection' | 'laserModuleEvidence'>,
): LaserModuleEvidence | null {
  const observation = state.laserModuleEvidence ?? null;
  if (state.connection.kind !== 'connected' || observation === null) return null;
  return { module: observation.module, constantPowerMode: observation.constantPowerMode };
}

/** Ask the controller whether its laser module is loaded; a no-op for drivers
 *  without a probe. Best effort: a failed or skipped probe keeps the evidence
 *  the connection already has. */
export async function probeLaserModule(args: {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: LaserModuleProbeRefs;
  readonly write: ProbeWriteFn;
  readonly commandKind: ControllerCommandKind;
  readonly isCurrent: () => boolean;
}): Promise<void> {
  const { set, get, refs } = args;
  const probe = refs.driver.laserModuleProbe;
  // A halted Smoothieware board answers every non-exempt line with `!!`.
  if (probe === undefined || get().statusReport?.state !== 'Idle') return;
  let responses: ReadonlyArray<string>;
  try {
    responses = await startControllerCommand(refs, args.write, {
      kind: args.commandKind,
      label: 'laser module check',
      command: `${probe.command}\n`,
      timeoutMs: PROBE_TIMEOUT_MS,
      source: 'system',
    });
  } catch (error) {
    if (!args.isCurrent()) return;
    const message = error instanceof Error ? error.message : String(error);
    set((state) => ({
      log: pushLog(
        state,
        `[lf2] Laser module check (${probe.command}) did not complete: ${message}.`,
      ),
    }));
    return;
  }
  if (!args.isCurrent()) return;
  const evidence = probe.parse(responses);
  const state = get();
  const selected = selectControllerDriver(
    state.activeControllerKind,
    state.activeControllerCommandSet ?? undefined,
  );
  refs.driver = evidence.module === 'absent' ? probe.withoutLaserModule(selected) : selected;
  set((current) => ({
    laserModuleEvidence: {
      ...evidence,
      rawLines: responses.slice(0, MAX_RAW_LINES),
      sessionEpoch: current.controllerSessionEpoch,
    },
    log: pushLog(current, laserModuleLogLine(evidence)),
  }));
}

/** The connect handshake's qualification for a driver without a settings dump:
 *  probe the laser module when the driver has a probe, then qualify. */
export async function qualifyWithoutSettingsDump(args: {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: LaserModuleProbeRefs;
  readonly write: ProbeWriteFn;
  readonly epoch: number;
  /** The handshake still owns this connection and write epoch. */
  readonly isCurrent: () => boolean;
  /** Parks the handshake for an MPG takeover; true when it did. */
  readonly parkForMpg: () => boolean;
  /** Re-arms qualification for the next fresh Idle. */
  readonly resume: () => void;
}): Promise<void> {
  const { set, get, epoch } = args;
  await probeLaserModule({
    set,
    get,
    refs: args.refs,
    write: args.write,
    commandKind: 'connection-handshake',
    isCurrent: () => args.isCurrent() && get().controllerSessionEpoch === epoch,
  });
  // An in-session Alarm during the check: qualify on the next fresh Idle.
  if (!args.isCurrent()) return args.resume();
  if (args.parkForMpg()) return;
  set({
    controllerQualification: qualifiedController(epoch, 'not-required'),
    log: pushLog(get(), '[lf2] Connected.'),
  });
}

const LASER_MODULE_CHECK_LABEL = 'Checking the laser module';

/** Re-qualification (the scheduler after a boot banner, or Retry) for a
 *  driver with no settings dump: re-check the laser module, then qualify. */
export async function requalifyWithoutSettingsDump(
  set: SetFn,
  get: GetFn,
  refs: LaserModuleProbeRefs,
  write: ProbeWriteFn,
  epoch: number,
): Promise<void> {
  await probeLaserModuleForQualification(set, get, refs, write, epoch);
  set((state) =>
    state.controllerSessionEpoch !== epoch
      ? {}
      : {
          controllerQualification: qualifiedController(epoch, 'not-required'),
          lastWriteError: null,
          log: pushLog(
            state,
            `[lf2] ${refs.driver.label} does not require a controller settings dump.`,
          ),
        },
  );
}

// The probe, owned as an interactive controller operation while it runs.
async function probeLaserModuleForQualification(
  set: SetFn,
  get: GetFn,
  refs: LaserModuleProbeRefs,
  write: ProbeWriteFn,
  epoch: number,
): Promise<void> {
  if (refs.driver.laserModuleProbe === undefined) return;
  set({
    controllerOperation: interactiveControllerOperation(
      LASER_MODULE_CHECK_LABEL,
      'terminal-exchange',
    ),
  });
  try {
    await probeLaserModule({
      set,
      get,
      refs,
      write,
      commandKind: 'interactive-command',
      isCurrent: () => get().controllerSessionEpoch === epoch,
    });
  } finally {
    set((state) =>
      state.controllerOperation?.kind === 'interactive-command' &&
      state.controllerOperation.label === LASER_MODULE_CHECK_LABEL
        ? { controllerOperation: null }
        : {},
    );
  }
}

function laserModuleLogLine(evidence: LaserModuleEvidence): string {
  if (evidence.module === 'absent') {
    return '[lf2] Laser module not loaded: the controller printed no laser report. Jog, Frame and Home skip `fire off`; laser output is refused.';
  }
  return evidence.constantPowerMode === true
    ? '[lf2] Laser module loaded.'
    : '[lf2] Laser module loaded (build without M221 P: constant-power layers run speed-proportional).';
}
