import { useMemo } from 'react';
import {
  controllerFingerprintFromEvidence,
  type ControllerFingerprint,
} from '../../core/saved-machines/controller-fingerprint';
import { useLaserStore } from '../state/laser-store';

/** The live controller's identity once its connection is qualified; null while
 * disconnected or still reading settings. Subscribes field by field so an
 * unrelated status report does not rebuild it. */
export function useConnectedControllerFingerprint(): ControllerFingerprint | null {
  const connected = useLaserStore((state) => state.connection.kind === 'connected');
  const qualified = useLaserStore((state) => state.controllerQualification.kind === 'qualified');
  const firmware = useLaserStore((state) => state.detectedControllerKind);
  const buildInfo = useLaserStore((state) => state.controllerBuildInfo);
  const usb = useLaserStore((state) => state.serialPortInfo ?? null);
  const settings = useLaserStore((state) => state.grblSettingsRows);
  return useMemo(
    () =>
      connected && qualified
        ? controllerFingerprintFromEvidence({ firmware, buildInfo, usb, settings })
        : null,
    [connected, qualified, firmware, buildInfo, usb, settings],
  );
}
