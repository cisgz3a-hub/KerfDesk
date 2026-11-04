import type { PreparedStartProgram } from '../../state/framed-run';
import {
  transferredCanvasMotionPlan,
  type ArchivedCanvasMotionPlan,
} from '../../state/recovery/execution-artifact-canvas';
import {
  hasColumnPackedEncoding,
  packedManifestTransferables,
  unpackTrustedMotionManifest,
  type PackedMotionManifest,
} from '../../state/recovery/packed-motion-manifest';
import type { LaserSecondPassFrameGeometry } from '../second-pass-preparation-proof';
import type { SecondPassDrawing } from './second-pass-preview';

export type SecondPassPreview = {
  prepared: PreparedStartProgram;
  drawing: SecondPassDrawing;
  burnLengthMm: number;
  clamped: boolean;
};

/**
 * A compiled pass and its Frame geometry as they cross the worker boundary.
 * A structured clone strips the motion manifest's column class, so the
 * manifest travels packed and its buffers are transferred, as the Start
 * handoff does (ADR-244 Amendment 3). The client hydrates both before any
 * caller sees them.
 */
export type TransferredSecondPassPreview = Omit<SecondPassPreview, 'prepared'> & {
  readonly prepared: Omit<PreparedStartProgram, 'canvasPlan'> & {
    readonly canvasPlan: ArchivedCanvasMotionPlan;
  };
};

export type TransferredSecondPassFrameGeometry = Omit<LaserSecondPassFrameGeometry, 'manifest'> & {
  readonly manifest: PackedMotionManifest;
};

export function packedPlanTransferables(plan: ArchivedCanvasMotionPlan): ArrayBuffer[] {
  return hasColumnPackedEncoding(plan.manifest) ? packedManifestTransferables(plan.manifest) : [];
}

export function hydrateSecondPassPreview(value: TransferredSecondPassPreview): SecondPassPreview {
  return {
    ...value,
    prepared: {
      ...value.prepared,
      canvasPlan: transferredCanvasMotionPlan(value.prepared.canvasPlan),
    },
  };
}

export function hydrateSecondPassFrameGeometry(
  value: TransferredSecondPassFrameGeometry,
): LaserSecondPassFrameGeometry {
  return { ...value, manifest: unpackTrustedMotionManifest(value.manifest) };
}
