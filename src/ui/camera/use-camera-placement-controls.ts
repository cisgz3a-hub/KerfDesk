import { useEffect } from 'react';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { cancelOverlayCapture, captureOverlayStill } from './capture-overlay-still';

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
  const bedPicture = useCameraStore((s) => s.bedPicture);
  const setBedPicture = useCameraStore((s) => s.setBedPicture);
  const active = useCameraStore((s) => s.placementActive);
  const activate = useCameraStore((s) => s.activatePlacement);
  const deactivate = useCameraStore((s) => s.deactivatePlacement);
  const confirmedEpoch = useCameraStore((s) => s.confirmedPositionEpoch);
  const confirmEpoch = useCameraStore((s) => s.confirmPositionEpoch);
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const homingState = useLaserStore((s) => s.homingState);
  const positionEpoch = useLaserStore((s) => s.trustedPositionEpoch ?? 0);
  const overlayUsable = still !== null || bedPicture !== null || sourceState.kind === 'live';

  useEffect(() => {
    if (!overlayGeometryReady || !visible || !overlayUsable || active) return;
    activate();
  }, [activate, active, overlayGeometryReady, overlayUsable, visible]);

  const toggleOverlay = (): void => {
    cancelOverlayCapture();
    setVisible(!visible);
    if (!visible && overlayGeometryReady) activate();
  };
  const updateStill = async (): Promise<void> => {
    await captureOverlayStill(undefined, { activatePlacement: overlayGeometryReady });
  };
  const useLive = (): void => {
    cancelOverlayCapture();
    setStill(null);
    setBedPicture(null);
    if (overlayGeometryReady) activate();
  };
  const exit = (): void => {
    cancelOverlayCapture();
    deactivate();
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
