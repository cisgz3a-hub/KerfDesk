// The bed frame the open project's machine is set up with now, and a saved
// camera calibration expressed in it (rolling audit 12-P2-2, ADR-440
// Amendment 1). Kept apart from active-camera-model.ts, which the browser Free
// build replaces with inert stubs (scripts/browser-free-build.ts), so the
// calibration wizard, head capture and job watch can read the frame there too.

import { useMemo } from 'react';
import {
  cameraModelInBedFrame,
  type CameraBedFrame,
} from '../../core/camera/model/camera-bed-frame';
import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { cameraBedFrameFor, selectNativeBedEvidence } from '../state/native-bed-frame';

/** The bed frame the open project's machine is set up with now. */
export function cameraBedFrameNow(): CameraBedFrame {
  return cameraBedFrameFor(useStore.getState().project.device, useLaserStore.getState());
}

/** {@link cameraBedFrameNow} for React. */
export function useCameraBedFrame(): CameraBedFrame {
  const device = useStore((s) => s.project.device);
  // The same snapshot until a connect, settings read or Home changes it.
  const evidence = useLaserStore(selectNativeBedEvidence);
  return useMemo(() => cameraBedFrameFor(device, evidence), [device, evidence]);
}

/**
 * `model` in the bed frame `bedFrame`, or undefined when it cannot be used
 * there. One result per saved model and frame, so an unchanged frame gives the
 * very same model.
 */
export function modelInBedFrame(
  model: CameraModelRecord,
  bedFrame: CameraBedFrame,
): CameraModelRecord | undefined {
  const key = JSON.stringify(bedFrame);
  const cached = framedAt.get(model);
  if (cached?.key === key) return cached.model;
  const placed = cameraModelInBedFrame(model, bedFrame);
  const framed = placed.kind === 'ok' ? placed.model : undefined;
  framedAt.set(model, { key, model: framed });
  return framed;
}

const framedAt = new WeakMap<
  CameraModelRecord,
  { readonly key: string; readonly model: CameraModelRecord | undefined }
>();
