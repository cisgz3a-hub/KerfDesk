import { buildMotionManifest, type MotionPoint } from '../../core/job/motion-manifest';
import {
  packMotionManifest,
  type PackedMotionManifest,
} from '../state/recovery/packed-motion-manifest';

/** Shared by the restart-preview worker and its client. Kept free of UI-store
 * imports so the worker bundle carries only the parser and the packer. */
export type LaserRecoveryPreviewRequest = {
  readonly gcode: string;
  readonly initialPosition: MotionPoint | null;
};

export type LaserRecoveryPreviewReply =
  | { readonly value: PackedMotionManifest }
  | { readonly error: string };

/** Parse the sealed program once and return it in columnar form. The preview
 * is transient, so it is not bound by the per-artifact archive budget. */
export function packRecoveryPreviewManifest(
  request: LaserRecoveryPreviewRequest,
): PackedMotionManifest {
  const manifest = buildMotionManifest(request.gcode, {
    machineKind: 'laser',
    ...(request.initialPosition === null ? {} : { initialPosition: request.initialPosition }),
  });
  return packMotionManifest(manifest, { enforceArchiveBudget: false });
}

export function packedManifestTransferables(packed: PackedMotionManifest): ArrayBuffer[] {
  return [packed.blockData.buffer, packed.pointData.buffer].filter(
    (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
  );
}
