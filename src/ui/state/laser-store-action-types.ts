import type { JogParams, RealtimeOverrideByte } from '../../core/controllers/grbl';
import type { ControllerKind } from '../../core/devices';
import type { PlatformAdapter } from '../../platform/types';
import type { AutofocusResult } from './autofocus-action';
import type { ConsoleCommandOptions } from './laser-console-actions';
import type { FrameVerification } from './frame-verification';
import type { StartJobOptions } from './laser-job-options';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import type { ProbeResult } from './probe-actions';
import type { WorkZRecoveryConfirmation } from './work-z-recovery-actions';

export type ConnectControllerOptions = {
  readonly controllerKind?: ControllerKind | undefined;
  readonly baudRate?: number | undefined;
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
  readonly wakeController: () => Promise<void>;
  readonly configureGrblLaserSetup: () => Promise<void>;
  readonly readMachineSettings: () => Promise<void>;
  readonly writeGrblSetting: (id: number, value: string) => Promise<void>;
  readonly sendConsoleCommand: (command: string, options?: ConsoleCommandOptions) => Promise<void>;
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
  ) => Promise<void>;
  readonly startJob: (gcode: string, options?: StartJobOptions) => Promise<void>;
  readonly pauseJob: () => Promise<void>;
  readonly resumeJob: () => Promise<void>;
  readonly continueToolChange: () => Promise<void>;
  readonly stopJob: () => Promise<void>;
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
  readonly markFrameVerified: (verification: FrameVerification) => void;
};
