import { useCallback } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import { outlineMachineCorner, type OutlineBoardGeometry } from '../../../core/scene';
import { useLaserStore } from '../../state/laser-store';
import { resolveNativeBedFrame, selectNativeBedEvidence } from '../../state/native-bed-frame';
import { capturedMachinePointToScene } from '../print-cut-capture-frame';

export function useOutlineSceneTopLeft(
  device: DeviceProfile,
): (outline: OutlineBoardGeometry) => { readonly x: number; readonly y: number } | undefined {
  const nativeBedEvidence = useLaserStore(selectNativeBedEvidence);
  return useCallback(
    (outline) => {
      const corner = outlineMachineCorner(outline, 'back-left');
      const frame = resolveNativeBedFrame(device, nativeBedEvidence);
      if (corner === null || frame === null) return undefined;
      return capturedMachinePointToScene({ ...corner, z: 0 }, device, false, frame) ?? undefined;
    },
    [device, nativeBedEvidence],
  );
}
