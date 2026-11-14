// The camera helpers (ADR-663 Amendment 1), installed once for the workspace:
// - remember which camera ran, so it starts again next time (the USB camera by
//   its device, so another one is never started in its place);
// - start a calibrated camera with KerfDesk, when a calibration arrives with
//   the project, and when the laser connects (its own camera answers then), so
//   the canvas shows the bed without opening the Camera panel;
// - take a new held picture when a job finishes, once the head has settled;
// - finish an Alt+C that had to start the camera first;
// - check whether the camera has moved, on each new held picture and once
//   just after it starts (Amendment 3);
// - keep a bed picture where its part of the bed is, or drop it, when Machine
//   Setup changes, and take a canvas target's bed frame at the Start that
//   burns its rings (ADR-440 Amendment 5).
// Each helper acts only on a camera that is not running, and the operator can
// switch the start and the after-job refresh off in Camera settings.

import { useEffect } from 'react';
import { BROWSER_FREE_BUILD } from '../../../platform/build-capabilities';
import { usePlatform } from '../../app/platform-context';
import { useStore } from '../../state';
import {
  loadLastCameraSource,
  saveLastCameraSource,
  savePreferredCameraId,
} from '../../state/camera-preference-storage';
import { useCameraStore } from '../../state/camera-store';
import type { LiveCanvasRun } from '../../state/canvas-motion-plan';
import { useLaserStore } from '../../state/laser-store';
import { followBedPictureFrame } from '../bed-picture-frame';
import { watchCanvasTargetBurns } from '../calibrate/canvas-target-burn';
import { AFTER_SETTLE_MS } from '../job-watch/job-watch-runner';
import { localCameraBridgeAvailable } from '../panel/camera-platform-capability';
import { lastSourceKind, startRememberedCamera, type CameraStartDeps } from './auto-start';
import { useCameraHelpersStore } from './camera-helpers-store';
import { checkCameraMovedInWorker, rgbaView } from './moved-check';
import { checkStartedCameraMoved } from './moved-check-capture';
import { checkLivePictureForMoves } from './live-moved-check';
import { scheduleAfterJobRefresh } from './schedule-after-job-refresh';
import { refreshCameraPicture, reportRefresh, takePendingRefresh } from './refresh-picture';

export function installCameraHelpers(deps: CameraStartDeps): () => void {
  const starts = new AbortController();
  const stops = [
    rememberRunningCamera(),
    refreshAfterJobs(),
    checkForMoves(),
    // ADR-663 Amendment 8: a live picture is checked again while it is shown.
    checkLivePictureForMoves(),
    followBedPictureFrame(),
    watchCanvasTargetBurns(),
  ];
  if (!BROWSER_FREE_BUILD) {
    stops.push(startCalibratedCamera(deps, starts.signal));
    void startIfCalibrated(deps, starts.signal);
  }
  return () => {
    starts.abort();
    stops.forEach((stop) => stop());
  };
}

export function useCameraHelpers(): void {
  const platform = usePlatform();
  useEffect(
    () =>
      installCameraHelpers({
        camera: platform.camera,
        bridge: platform.cameraBridge,
        bridgeAvailable: localCameraBridgeAvailable(platform.id, window.location.hostname),
      }),
    [platform],
  );
}

function rememberRunningCamera(): () => void {
  return useCameraStore.subscribe((state, previous) => {
    const { sourceState } = state;
    if (sourceState === previous.sourceState || sourceState.kind !== 'live') return;
    const source = sourceState.source;
    saveLastCameraSource(lastSourceKind(source, state.machineCamera));
    // The device that actually opened, which a later start looks for.
    if (source.kind === 'usb' && source.stream.sourceId !== '') {
      savePreferredCameraId(source.stream.sourceId);
    }
    if (takePendingRefresh()) void refreshCameraPicture().then(reportRefresh);
  });
}

// A calibrated camera puts the bed on the canvas, so it starts by itself; one
// without a calibration starts when the Camera panel opens.
function startIfCalibrated(deps: CameraStartDeps, signal: AbortSignal): Promise<void> {
  if (useStore.getState().project.device.cameraModel === undefined) return Promise.resolve();
  if (loadLastCameraSource() === null) return Promise.resolve();
  return startRememberedCamera(deps, signal);
}

function startCalibratedCamera(deps: CameraStartDeps, signal: AbortSignal): () => void {
  const stopLaser = useLaserStore.subscribe((state, previous) => {
    if (state.connection.kind === 'connected' && previous.connection.kind !== 'connected') {
      void startIfCalibrated(deps, signal);
    }
  });
  const stopProject = useStore.subscribe((state, previous) => {
    const model = state.project.device.cameraModel;
    if (model !== undefined && previous.project.device.cameraModel === undefined) {
      void startIfCalibrated(deps, signal);
    }
  });
  return () => {
    stopLaser();
    stopProject();
  };
}

// A held picture is already taken, so it costs nothing to check. A camera
// that has just started is checked once it has settled.
function checkForMoves(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = useCameraStore.subscribe((state, previous) => {
    const { sourceState } = state;
    if (sourceState.kind !== 'live') return;
    if (state.overlayStill !== null && state.overlayStill !== previous.overlayStill) {
      // Compared in the camera picture worker (ADR-663 Amendment 6).
      void checkCameraMovedInWorker(sourceState.source, rgbaView(state.overlayStill)).catch(
        () => undefined,
      );
    }
    if (
      previous.sourceState.kind === 'live' &&
      previous.sourceState.source === sourceState.source
    ) {
      return;
    }
    if (timer !== null) clearTimeout(timer);
    const source = sourceState.source;
    timer = setTimeout(() => {
      timer = null;
      const now = useCameraStore.getState().sourceState;
      if (now.kind !== 'live' || now.source !== source) return;
      // Read in the camera picture worker (ADR-663 Amendment 6).
      void checkStartedCameraMoved(source).catch(() => undefined);
    }, MOVED_CHECK_SETTLE_MS);
  });
  return () => {
    stop();
    if (timer !== null) clearTimeout(timer);
  };
}

// Long enough for a camera's exposure to settle after it starts.
export const MOVED_CHECK_SETTLE_MS = 3000;

// Only a held picture needs refreshing: the live camera follows the job anyway.
function refreshAfterJobs(): () => void {
  let refreshed: LiveCanvasRun['plan'] | null = null;
  let cancelRefresh: (() => void) | null = null;
  const stop = useLaserStore.subscribe((state) => {
    const run = state.liveCanvasRun ?? null;
    if (run === null || run.lifecycle !== 'finished' || refreshed === run.plan) return;
    refreshed = run.plan;
    if (!useCameraHelpersStore.getState().settings.refreshAfterJob) return;
    if (useCameraStore.getState().overlayStill === null) return;
    cancelRefresh?.();
    cancelRefresh = scheduleAfterJobRefresh(run.plan, AFTER_SETTLE_MS);
  });
  return () => {
    stop();
    cancelRefresh?.();
  };
}
