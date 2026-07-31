import type { ProgramEvent, UnsupportedWordCount } from '../gcode-view';
import type { OutputStrategy } from '../output';
import type { MachineKind } from '../scene';

export const EXECUTABLE_PLAN_SCHEMA = 'curvedesk.executable-plan' as const;
export const EXECUTABLE_PLAN_SCHEMA_VERSION = 1 as const;

export type ExecutablePlanController = OutputStrategy['id'];
export type ExecutablePlanMotionMode =
  | 'rapid'
  | 'linear'
  | 'clockwise-arc'
  | 'counterclockwise-arc';
export type ExecutablePlanMotionIntent = 'travel' | 'process' | 'plunge' | 'retract' | 'park';

export type ExecutablePlanPoint = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type ExecutablePlanMotion = {
  readonly id: string;
  /** Zero-based index in compatibility.exactProgram. */
  readonly rawLineIndex: number;
  /** Zero-based index among controller-sendable lines. */
  readonly sendableLineIndex: number;
  readonly programLineNumber: number | null;
  readonly mode: ExecutablePlanMotionMode;
  readonly intent: ExecutablePlanMotionIntent;
  readonly pointsMm: ReadonlyArray<ExecutablePlanPoint>;
  readonly lengthMm: number;
  readonly routeStartMm: number;
  readonly routeEndMm: number;
  readonly feedMmPerMin: number | null;
  readonly power: number;
  readonly sourceSegmentCount: number;
};

export type ExecutablePlanBounds = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
};

export type ExecutablePlanTotals = {
  readonly routeMm: number;
  readonly travelMm: number;
  readonly processMm: number;
  readonly plungeMm: number;
  readonly retractMm: number;
  readonly parkMm: number;
};

export type ExecutablePlanTerminalState = {
  readonly positionMm: ExecutablePlanPoint | null;
  readonly spindleMode: 'off' | 'constant' | 'dynamic';
  readonly coolant: 'off' | 'mist' | 'flood' | 'mist-and-flood';
  readonly programEnded: boolean;
};

export type ExecutablePlanV1 = {
  readonly schema: typeof EXECUTABLE_PLAN_SCHEMA;
  readonly schemaVersion: typeof EXECUTABLE_PLAN_SCHEMA_VERSION;
  readonly machineKind: MachineKind;
  readonly controller: {
    readonly emitter: ExecutablePlanController;
    readonly profileControllerKind: string | null;
  };
  readonly coordinateSystem: {
    readonly units: 'mm';
    readonly distanceMode: 'absolute';
    readonly initialPositionMm: ExecutablePlanPoint;
    readonly initialPositionBasis: 'assumed-work-origin-v1';
  };
  readonly source: {
    readonly rawLineCount: number;
    readonly sendableLineCount: number;
    readonly utf8ByteLength: number;
    readonly lineEnding: 'none' | 'lf' | 'crlf' | 'cr' | 'mixed';
  };
  readonly motions: ReadonlyArray<ExecutablePlanMotion>;
  readonly events: ReadonlyArray<ProgramEvent>;
  readonly bounds: {
    readonly allMotionMm: ExecutablePlanBounds | null;
    readonly processMm: ExecutablePlanBounds | null;
  };
  readonly totals: ExecutablePlanTotals;
  readonly terminal: ExecutablePlanTerminalState;
  readonly diagnostics: {
    readonly unsupportedWords: ReadonlyArray<UnsupportedWordCount>;
  };
  /**
   * Transitional v1 lexical carrier. It is deliberately lossless so the new
   * serializer can round-trip today's emitter without changing one byte.
   */
  readonly compatibility: {
    readonly serializer: 'legacy-gcode-v1';
    readonly exactProgram: string;
  };
};

export type BuildExecutablePlanOptions = {
  readonly machineKind: MachineKind;
  readonly controller: ExecutablePlanController;
  readonly profileControllerKind?: string;
};

export type ExecutablePlanBuildIssue = {
  readonly code:
    | 'render-parse-error'
    | 'skipped-motion'
    | 'motion-line-mismatch'
    | 'compound-motion-line'
    | 'endpoint-mismatch';
  readonly message: string;
  readonly rawLineIndex?: number;
};

export type BuildExecutablePlanResult =
  | { readonly kind: 'ok'; readonly plan: ExecutablePlanV1 }
  | { readonly kind: 'unavailable'; readonly reason: 'no-program' }
  | {
      readonly kind: 'error';
      readonly reason: 'parse-error' | 'semantic-mismatch';
      readonly issues: ReadonlyArray<ExecutablePlanBuildIssue>;
    };
