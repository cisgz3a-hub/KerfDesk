import type { JogParams, RealtimeOverrideByte } from '../../core/controllers/grbl';
import type { ControllerCommandSet, ControllerKind } from '../../core/devices/device-profile';
import type { PlatformAdapter } from '../../platform/types';
import type { AutofocusResult } from './autofocus-action';
import type { ConsoleCommandOptions } from './laser-console-actions';
import type { FramedRunCandidate, FrameTraceCandidate } from './framed-run';
import type { FrameWcsSelection } from './frame-wcs-selection';
import type { StartJobOptions } from './laser-job-options';
import type { JobStopReason } from './job-stop-request';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import type { ProbeResult } from './probe-actions';
import type { WorkZRecoveryConfirmation } from './work-z-recovery-actions';

export type ControllerWakeOutcome = 'idle' | 'alarm';

export type ConnectControllerOptions = {
  readonly controllerKind?: ControllerKind | undefined;
  readonly controllerCommandSet?: ControllerCommandSet | undefined;
  readonly baudRate?: number | undefined;
  /** Ask the platform for the worker-hosted transport (ADR-334). Advisory:
   * a runtime that cannot transfer the port's streams keeps the main-thread
   * transport and the job streams exactly as it always has. */
  readonly hostedStreaming?: boolean | undefined;
  /** Which port to open (ADR-420). 'remembered', the default, reuses the port
   * the operator picked before when exactly one fits and shows the picker
   * otherwise; 'choose' always shows the picker; 'automatic' never does and
   * ends quietly when no remembered port is attached. */
  readonly portSelection?: 'remembered' | 'choose' | 'automatic' | undefined;
};

export type LaserStoreActions = {
  readonly connect: (adapter: PlatformAdapter, options?: ConnectControllerOptions) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly forgetDevice?: () => Promise<void>;
  readonly home: () => Promise<void>;
  readonly autofocus: (command: string) => Promise<AutofocusResult>;
  readonly probe: (request: ProbeRequest) => Promise<ProbeResult>;
  readonly confirmProbePlateRemoved: () => void;
  readonly sendRealtimeOverride: (byte: RealtimeOverrideByte) => Promise<void>;
  readonly unlockAlarm: () => Promise<void>;
  /** Soft-resets the controller and waits for it to settle. Resolves 'alarm'
   *  when it comes back locked, as GRBL, grblHAL and FluidNC all do after a
   *  reset from Sleep or a critical alarm (the Alarm banner then takes over). */
  readonly wakeController: () => Promise<ControllerWakeOutcome>;
  readonly configureGrblLaserSetup: () => Promise<void>;
  readonly readMachineSettings: () => Promise<void>;
  readonly retryControllerQualification: () => Promise<void>;
  readonly writeGrblSetting: (id: number, value: string) => Promise<void>;
  readonly sendConsoleCommand: (command: string, options?: ConsoleCommandOptions) => Promise<void>;
  /** Owned G54 selection used before preparing Frame so Frame and emitted
   * program resolve coordinates in the same canonical WCS. */
  readonly selectPrimaryWcsForFrame: () => Promise<FrameWcsSelection>;
  /** One realtime status query outside the periodic poll, so a caller that
   * needs a fresh report after an owned command gets it in one round trip
   * instead of waiting for the next poll tick. Inert to the planner; a no-op
   * without a realtime query or while a controller operation owns polling. */
  readonly requestControllerStatus: () => Promise<void>;
  readonly clearTranscript: () => void;
  readonly jog: (params: JogParams) => Promise<void>;
  readonly jogToMachinePosition: (x: number, y: number, feed: number) => Promise<void>;
  readonly setAirAssistEnabled: (enabled: boolean) => Promise<void>;
  readonly setFireActive: (active: boolean, requestedPercent?: number) => Promise<void>;
  readonly cancelJog: () => Promise<void>;
  readonly frame: (
    bounds: {
      readonly minX: number;
      readonly minY: number;
      readonly maxX: number;
      readonly maxY: number;
    },
    feed: number,
    candidate?: FramedRunCandidate,
  ) => Promise<void>;
  /** Physically trace a job's bounds before its exact program exists. Same
   * motion and completion boundary as `frame`, but a clean completion records
   * `frameTrace` instead of minting a permit; the Frame flow binds the exact
   * program to that trace once it arrives (ADR-353). */
  readonly traceFrame: (
    bounds: {
      readonly minX: number;
      readonly minY: number;
      readonly maxX: number;
      readonly maxY: number;
    },
    feed: number,
    candidate: FrameTraceCandidate,
  ) => Promise<void>;
  readonly startJob: (gcode: string, options?: StartJobOptions) => Promise<void>;
  readonly pauseJob: () => Promise<void>;
  readonly resumeJob: () => Promise<void>;
  readonly continueToolChange: () => Promise<void>;
  /** Abort the running job. `reason` records why for recovery (default: the operator). */
  readonly stopJob: (reason?: JobStopReason) => Promise<void>;
  readonly clearSafetyNotice: () => void;
  readonly pushSystemNotice: (line: string) => void;
  readonly applyDetectedSettings: () => void;
  readonly dismissDetectedSettings: () => void;
  readonly setOriginHere: () => Promise<void>;
  readonly zeroZHere: () => Promise<void>;
  readonly recoverWorkZFromController: (confirmation: WorkZRecoveryConfirmation) => Promise<void>;
  readonly resetOrigin: () => Promise<void>;
  readonly setPersistentOriginHere: () => Promise<void>;
  readonly clearPersistentOrigin: () => Promise<void>;
  readonly releaseMotors: () => Promise<void>;
};
