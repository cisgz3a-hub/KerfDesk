import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  type ControllerKind,
  type DeviceProfile,
} from '../../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import {
  controllerProfileForSelection,
  controllerSelectionChanges,
} from './device-setup-controller-selection';

const CALIBRATED_FALCON: DeviceProfile = {
  ...FALCON_A1_PRO_GRBLHAL_PROFILE,
  scanningOffsets: [
    { speedMmPerMin: 3000, offsetMm: 0.1 },
    { speedMmPerMin: 6000, offsetMm: 0.18 },
  ],
  scanOffsetCalibrationStatus: 'verified',
};

function rows(profile: DeviceProfile, kind: ControllerKind) {
  return controllerSelectionChanges(profile, kind).map(({ label, from, to }) => ({
    label,
    from,
    to,
  }));
}

// Choosing another controller runs the controller compatibility policy, which
// can change more of the draft than the controller. Machine Setup lists each
// change before "Use detected" applies it (ADR-375).
describe('controller selection changes (ADR-375)', () => {
  it('lists the receive window and scan calibration a GRBL relabel changes on a Falcon', () => {
    expect(rows(CALIBRATED_FALCON, 'grbl-v1.1')).toEqual([
      { label: 'RX window', from: '1024 bytes', to: '120 bytes' },
      {
        label: 'Raster scan-offset calibration',
        from: '2 points, verified',
        to: 'Not calibrated',
      },
    ]);
    const next = controllerProfileForSelection(CALIBRATED_FALCON, 'grbl-v1.1');
    expect(next.rxBufferBytes).toBe(120);
    expect(next.scanningOffsets).toEqual([]);
    expect(next.scanOffsetCalibrationStatus).toBeUndefined();
    // A GRBL-family relabel keeps the vendor commands, so they are not listed.
    expect(next.controllerCommandSet).toBe('creality-falcon-a1-pro');
  });

  it('lists the vendor commands a move off the GRBL family drops', () => {
    expect(rows(FALCON_A1_PRO_GRBLHAL_PROFILE, 'fluidnc')).toContainEqual({
      label: 'Vendor commands',
      from: 'Falcon A1 Pro (GRBL-compatible commands)',
      to: 'None',
    });
    expect(
      controllerProfileForSelection(FALCON_A1_PRO_GRBLHAL_PROFILE, 'fluidnc').controllerCommandSet,
    ).toBeUndefined();
  });

  it("lists grblHAL's larger receive window, and nothing for the same controller", () => {
    expect(rows(DEFAULT_DEVICE_PROFILE, 'grblhal')).toEqual([
      { label: 'RX window', from: '120 bytes', to: '1024 bytes' },
    ]);
    expect(controllerSelectionChanges(DEFAULT_DEVICE_PROFILE, 'grbl-v1.1')).toEqual([]);
  });
});
