// Capture → flatten → find the two printed marks → fill both Print and Cut
// registration points from the camera (ADR-443). The result stays a proposal
// until Apply registration, exactly as head captures are.

import { useState } from 'react';
import type { PrintAndCutDesignTargets } from '../../core/scene';
import { cameraModelForFrame } from '../camera/camera-model-frame';
import { cameraCaptureBindingForFrame, captureSourceFrame } from '../camera/frame-source';
import { useCameraTraceLifetime } from '../camera/use-camera-trace-lifetime';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { nativeBedCaptureFrameKey } from '../state/native-bed-frame';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { designMarkSizeMm, locatePrintCutMarks, markPairMessage } from './print-cut-camera';

export type PrintCutCamera = {
  /** A saved camera model: the dialog offers the camera. */
  readonly offered: boolean;
  /** And a live camera: a search can start. */
  readonly available: boolean;
  readonly finding: boolean;
  readonly message: string | null;
  readonly find: (targets: PrintAndCutDesignTargets) => Promise<void>;
};

export function usePrintCutCamera(): PrintCutCamera {
  const model = useStore((s) => s.project.device.cameraModel);
  const sourceState = useCameraStore((s) => s.sourceState);
  const captureLifetime = useCameraTraceLifetime();
  const [finding, setFinding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const find = async (targets: PrintAndCutDesignTargets): Promise<void> => {
    if (sourceState.kind !== 'live' || model === undefined) return;
    const isCurrent = captureLifetime();
    setFinding(true);
    setMessage(null);
    const raw = await captureSourceFrame(sourceState.source);
    // Let "Finding marks…" paint before the search takes the thread.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!isCurrent()) {
      setFinding(false);
      return;
    }
    const done = (text: string): void => {
      setFinding(false);
      setMessage(text);
    };
    if (raw === null) return done('Could not capture a camera frame.');
    const capture = cameraCaptureBindingForFrame(sourceState.source, raw.width, raw.height);
    const fitted = cameraModelForFrame(model, capture, raw.width, raw.height);
    if (fitted.kind === 'issue') return done(fitted.message);
    const { project } = useStore.getState();
    const camera = useCameraStore.getState();
    const result = locatePrintCutMarks({
      raw,
      lens: fitted.lens,
      pose: fitted.pose,
      bedWidthMm: project.device.bedWidth,
      bedHeightMm: project.device.bedHeight,
      surfaceHeightMm: camera.surfaceHeightMm,
      heightAreas: camera.heightAreas,
      targets,
      markSizeMm: designMarkSizeMm(project, targets),
    });
    if (result === null) return done('Could not build the bed image from the camera frame.');
    if (result.kind === 'found') {
      const laser = useLaserStore.getState();
      const epoch = laser.trustedPositionEpoch ?? 0;
      const frameKey = nativeBedCaptureFrameKey(project.device, laser);
      const session = usePrintCutSessionStore.getState();
      session.capture('first', result.pair.first.centre, epoch, frameKey, 'camera');
      session.capture('second', result.pair.second.centre, epoch, frameKey, 'camera');
    }
    done(markPairMessage(result, targets));
  };

  return {
    offered: model !== undefined,
    available: sourceState.kind === 'live' && model !== undefined,
    finding,
    message,
    find,
  };
}
