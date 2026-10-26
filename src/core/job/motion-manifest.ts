import type { MachineKind } from '../scene';

export type MotionPoint = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type MotionBlockKind = 'travel' | 'process' | 'plunge' | 'park';

export type MotionBlock = {
  /** Zero-based index in the exact G-code string passed to Start. */
  readonly rawLineIndex: number;
  /** Zero-based index among non-comment, non-blank streamed lines. */
  readonly sendableLineIndex: number;
  /** Optional source N-word used by firmware builds that report `Ln:`. */
  readonly programLineNumber: number | null;
  readonly kind: MotionBlockKind;
  readonly points: ReadonlyArray<MotionPoint>;
  readonly lengthMm: number;
  readonly routeStartMm: number;
  readonly routeEndMm: number;
};

export type MotionManifest = {
  readonly blocks: ReadonlyArray<MotionBlock>;
  readonly totalRouteMm: number;
  readonly sendableLineCount: number;
  readonly firstProcessPoint: MotionPoint | null;
  readonly finalPoint: MotionPoint | null;
};

export type BuildMotionManifestOptions = {
  readonly machineKind: MachineKind;
  readonly initialPosition?: MotionPoint;
  /** How the laser controller turns the beam on (ADR-096 Amendment 1), as the
   * Inspector reads it (`laserPowerControlForDevice`). Smoothieware fires any
   * G1-G3 with S > 0 while its M221 scale is above 0, without M3/M4. Absent
   * reads M3/M4/M106 as arming the beam. */
  readonly laserPowerControl?: 'spindle' | 'fan' | 'smoothieware' | undefined;
};

export { buildMotionManifest } from './motion-manifest-parser';
