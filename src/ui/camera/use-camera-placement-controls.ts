import { useCallback, useEffect } from 'react';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { captureSourceFrame } from './frame-source';
import { cameraCaptureBindingForFrame } from './frame-source';

export function useCameraPlacementControls(overlayGeometryReady: boolean): {
  readonly active: boolean;
  readonly homingEnabled: boolean;
  readonly positionTrusted: boolean;
  readonly toggleOverlay: () => void;
  readonly updateStill: () => Promise<void>;
  readonly useLive: () => void;
  readonly exit: () => void;
  readonly confirmPosition: () => void;
} {
  const sourceState = useCameraStore((s) => s.sourceState);
  const visible = useCameraStore((s) => s.overlayVisible);
  const setVisible = useCameraStore((s) => s.setOverlayVisible);
  const still = useCameraStore((s) => s.overlayStill);
  const setStill = useCameraStore((s) => s.setOverlayStill);
  const active = useCameraStore((s) => s.placementActive);
  const activate = useCameraStore((s) => s.activatePlacement);
  const exit = useCameraStore((s) => s.deactivatePlacement);
  const confirmedEpoch = useCameraStore((s) => s.confirmedPositionEpoch);
  const confirmEpoch = useCameraStore((s) => s.confirmPositionEpoch);
  const setJobPlacement = useStore((s) => s.setJobPlacement);
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const homingState = useLaserStore((s) => s.homingState);
  const positionEpoch = useLaserStore((s) => s.trustedPositionEpoch ?? 0);
  const overlayUsable = still !== null || sourceState.kind === 'live';

  const activateAbsolute = useCallback((): void => {
    activate();
    setJobPlacement({ startFrom: 'absolute' });
  }, [activate, setJobPlacement]);

  useEffect(() => {
    if (!overlayGeometryReady || !visible || !overlayUsable || active) return;
    activateAbsolute();
  }, [activateAbsolute, active, overlayGeometryReady, overlayUsable, visible]);

  const toggleOverlay = (): void => {
    setVisible(!visible);
    if (!visible && overlayGeometryReady) activateAbsolute();
  };
  const updateStill = async (): Promise<void> => {
    if (sourceState.kind !== 'live') return;
    const frame = await captureSourceFrame(sourceState.source);
    if (frame === null) return;
    setStill(frame, cameraCaptureBindingForFrame(sourceState.source, frame.width, frame.height));
    if (overlayGeometryReady) activateAbsolute();
  };
  const useLive = (): void => {
    setStill(null);
    if (overlayGeometryReady) activateAbsolute();
  };
  const positionTrusted = homingEnabled
    ? homingState === 'confirmed'
    : confirmedEpoch === positionEpoch;

  return {
    active,
    homingEnabled,
    positionTrusted,
    toggleOverlay,
    updateStill,
    useLive,
    exit,
    confirmPosition: () => confirmEpoch(positionEpoch),
  };
}
