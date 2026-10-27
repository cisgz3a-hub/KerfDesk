import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { cancelOverlayCapture, captureOverlayStill } from './capture-overlay-still';

// The Camera panel's placement controls. The overlay itself latches placement
// whenever it draws a camera picture (camera-placement-latch.ts), panel open
// or not; these actions latch it too, at once, as the operator asks.
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
  const visible = useCameraStore((s) => s.overlayVisible);
  const setVisible = useCameraStore((s) => s.setOverlayVisible);
  const setStill = useCameraStore((s) => s.setOverlayStill);
  const setBedPicture = useCameraStore((s) => s.setBedPicture);
  const active = useCameraStore((s) => s.placementActive);
  const activate = useCameraStore((s) => s.activatePlacement);
  const deactivate = useCameraStore((s) => s.deactivatePlacement);
  const confirmedEpoch = useCameraStore((s) => s.confirmedPositionEpoch);
  const confirmEpoch = useCameraStore((s) => s.confirmPositionEpoch);
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const homingState = useLaserStore((s) => s.homingState);
  const positionEpoch = useLaserStore((s) => s.trustedPositionEpoch ?? 0);

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
