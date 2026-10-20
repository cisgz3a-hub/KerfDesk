import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import type { JobOriginPlacement } from '../../core/job';
import type { MotionPoint } from '../../core/job/motion-manifest';
import type { Vec2 } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import type { MachineStartSnapshot } from '../laser/start-job-readiness';
import { resolveNativeBedFrame } from './native-bed-frame';

export type MachineCoordinateFrame = {
  readonly kind: 'machine';
  readonly workOffsetMm: MotionPoint;
  readonly nativeToBedOffsetMm?: Vec2;
};

/** How a started or planned program's controller points land on the canvas. */
export type CanvasCoordinateFrame =
  | MachineCoordinateFrame
  | {
      readonly kind: 'relative';
      readonly jobOriginOffset: Vec2;
      /** Where the job really burns on the bed, when that is known. A User
       * Origin or Current Position job is drawn over its artwork (ADR-642);
       * the camera job watch still looks at the bed through this frame. */
      readonly bed?: MachineCoordinateFrame;
    };

type FrameMapping = {
  readonly device: DeviceProfile;
  readonly coordinateFrame: CanvasCoordinateFrame;
};

export function mapControllerPointToScene(point: MotionPoint, plan: FrameMapping): Vec2 {
  const frame = plan.coordinateFrame;
  if (frame.kind === 'relative') {
    return toSceneCoords(
      { x: point.x - frame.jobOriginOffset.x, y: point.y - frame.jobOriginOffset.y },
      plan.device,
    );
  }
  return toSceneCoords(
    {
      x: point.x + frame.workOffsetMm.x + (frame.nativeToBedOffsetMm?.x ?? 0),
      y: point.y + frame.workOffsetMm.y + (frame.nativeToBedOffsetMm?.y ?? 0),
    },
    plan.device,
  );
}

export function canvasCoordinateFrame(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
  machine: MachineStartSnapshot,
  reportInches: boolean,
  jobOrigin: JobOriginPlacement | undefined,
  relativeView: boolean,
): CanvasCoordinateFrame {
  const relative = { kind: 'relative', jobOriginOffset: prepared.jobOriginOffset } as const;
  const bed = knownBedFrame(prepared, machine, reportInches);
  if (relativeView || jobOrigin?.startFrom === 'verified-origin' || bed === null) return relative;
  // A job placed from an origin the operator set burns the artwork relative
  // to that origin, not where the artwork sits on the canvas. Drawn at the bed
  // position, its route and burn appeared as a second copy beside the
  // artwork, so it is drawn over the artwork the operator sees (ADR-642).
  if (jobOrigin?.startFrom === 'user-origin' || jobOrigin?.startFrom === 'current-position') {
    return { ...relative, bed };
  }
  return bed;
}

// A missing physical WCO is exactly the Verified-Origin contract: retain a
// truthful artwork-relative view and label that the bed position is unknown.
// The same contract covers an origin-anchored start on a machine whose bed
// position is unverified (no homing, or not homed this connection): GRBL
// still reports a numeric WCO, but MPos is power-on-relative, so drawing
// the job-relative program at those "bed" coordinates lands it offset from
// the artwork at a physically meaningless position (live repro 2026-07-17).
function knownBedFrame(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
  machine: MachineStartSnapshot,
  reportInches: boolean,
): MachineCoordinateFrame | null {
  const wcoRaw = machine.statusReport?.wco ?? machine.wcoCache ?? null;
  const nativeFrame = resolveNativeBedFrame(prepared.project.device, machine);
  if ((machine.workOriginActive === true && wcoRaw === null) || nativeFrame === null) return null;
  return {
    kind: 'machine',
    workOffsetMm:
      wcoRaw === null ? { x: 0, y: 0, z: 0 } : normalizedReportPoint(wcoRaw, reportInches),
    nativeToBedOffsetMm: nativeFrame.nativeToBedOffsetMm,
  };
}

/**
 * The translation from a route drawn over its artwork to where it burns on
 * the bed (ADR-642): zero unless the plan carries a known bed frame. Both
 * frames map controller points through the same device transform, so they
 * differ by one constant offset.
 */
export function artworkToBedShift(plan: FrameMapping): Vec2 {
  const frame = plan.coordinateFrame;
  if (frame.kind !== 'relative' || frame.bed === undefined) return { x: 0, y: 0 };
  const zero = { x: 0, y: 0, z: 0 };
  const onBed = mapControllerPointToScene(zero, {
    device: plan.device,
    coordinateFrame: frame.bed,
  });
  const onArtwork = mapControllerPointToScene(zero, plan);
  return { x: onBed.x - onArtwork.x, y: onBed.y - onArtwork.y };
}

export function normalizedReportPoint(point: MotionPoint, reportInches: boolean): MotionPoint {
  const [x, y, z] = normalizeReportedMPosToMm([point.x, point.y, point.z], reportInches);
  return { x, y, z };
}
