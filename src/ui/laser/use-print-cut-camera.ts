// Capture → flatten → find the two printed marks → fill both Print and Cut
// registration points from the camera (ADR-443). The result stays a proposal
// until Apply registration, exactly as head captures are.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrintAndCutDesignTargets } from '../../core/scene';
import type { MarkPair } from '../../core/camera/marks/match-mark-pair';
import { activeCameraModel, useActiveCameraModel } from '../camera/active-camera-model';
import { cameraModelForFrame } from '../camera/camera-model-frame';
import { cameraCaptureBindingForFrame, captureSourceFrame } from '../camera/frame-source';
import { useCameraTraceLifetime } from '../camera/use-camera-trace-lifetime';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { designMarkSizeMm, locatePrintCutMarks, markPairMessage } from './print-cut-camera';
import { printCutCameraRequest, type PrintCutCameraRequest } from './print-cut-camera-request';

export type PrintCutCamera = {
  /** A saved camera model: the dialog offers the camera. */
  readonly offered: boolean;
  /** And a live camera: a search can start. */
  readonly available: boolean;
  readonly finding: boolean;
  readonly message: string | null;
  readonly invalidate: () => void;
  readonly find: (targets: PrintAndCutDesignTargets) => Promise<void>;
};

export function usePrintCutCamera(): PrintCutCamera {
  const model = useActiveCameraModel();
  const sourceState = useCameraStore((s) => s.sourceState);
  const captureLifetime = useCameraTraceLifetime();
  const [finding, setFinding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef<PrintCutCameraRequest | null>(null);
  const invalidate = useCallback(() => {
    active.current = null;
    setFinding(false);
    setMessage(null);
  }, []);
  useEffect(
    () => () => {
      active.current = null;
    },
    [],
  );
  const owns = (request: PrintCutCameraRequest): boolean =>
    active.current === request && request.isCurrent();

  const find = async (targets: PrintAndCutDesignTargets): Promise<void> => {
    const { project } = useStore.getState();
    const camera = useCameraStore.getState();
    const source = camera.sourceState;
    const capturedModel = activeCameraModel(project.device, source);
    if (source.kind !== 'live' || capturedModel === undefined) return;
    const request = printCutCameraRequest(captureLifetime());
    active.current = request;
    setFinding(true);
    setMessage(null);
    try {
      const raw = await captureSourceFrame(source.source);
      // Let "Finding marks…" paint before the search takes the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!owns(request)) return;
      if (raw === null) return setMessage('Could not capture a camera frame.');
      const capture = cameraCaptureBindingForFrame(source.source, raw.width, raw.height);
      const fitted = cameraModelForFrame(capturedModel, capture, raw.width, raw.height);
      if (fitted.kind === 'issue') return setMessage(fitted.message);
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
      if (result === null)
        return setMessage('Could not build the bed image from the camera frame.');
      if (result.kind === 'found') capturePair(request, result.pair);
      setMessage(markPairMessage(result, targets));
    } catch {
      if (owns(request)) setMessage('Could not capture or read the camera frame. Try again.');
    } finally {
      if (active.current === request) {
        active.current = null;
        setFinding(false);
      }
    }
  };

  return {
    offered: model !== undefined,
    available: sourceState.kind === 'live' && model !== undefined,
    finding,
    message,
    invalidate,
    find,
  };
}

function capturePair(request: PrintCutCameraRequest, pair: MarkPair): void {
  const session = usePrintCutSessionStore.getState();
  session.capture('first', pair.first.centre, request.epoch, request.frameKey, 'camera', 'bed');
  session.capture('second', pair.second.centre, request.epoch, request.frameKey, 'camera', 'bed');
}
