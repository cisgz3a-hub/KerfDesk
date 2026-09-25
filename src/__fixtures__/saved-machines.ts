// Shared fixtures for the My machines tests (ADR-374).

import { settingsMapToRows, type GrblSettingRow } from '../core/controllers/grbl';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type DeviceProfile } from '../core/devices';

/** Every DeviceProfile field populated with a value unlike the default
 * profile's, so a switch that forgets any one of them fails a deep equality.
 * Typed as Required so a field added to DeviceProfile later does not compile
 * here until it is given a value too. */
export function everyFieldProfile(): Required<DeviceProfile> {
  return {
    ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    name: 'Shop 4040 with laser',
    savedMachineId: 'machine-every-field',
    profileId: 'neotronics-4040-max-lt4lds-v2-20w',
    vendor: 'Neotronics',
    model: '4040 Max',
    profileSource: 'custom',
    catalogVersion: '2026-09-19',
    capabilities: ['grbl', 'wcs', 'laser-output', 'cnc-output', 'camera', 'rotary', 'z-axis'],
    evidence: [{ label: 'Bench', status: 'hardware-verified', note: 'Measured on the bench.' }],
    machineFamily: 'neotronics-4040-max',
    controllerKind: 'grbl-v1.1',
    controllerCommandSet: 'creality-falcon-a1-pro',
    baudRate: 115200,
    streamingMode: 'ping-pong',
    rxBufferBytes: 96,
    workerHostedStreaming: false,
    gcodeDialect: { dialectId: 'neotronics-4040-safe' },
    laserSubProfile: {
      model: 'LT-4LDS-V2',
      technology: 'diode',
      metadataConfidence: 'user-confirmed',
      opticalPowerW: 20,
      wavelengthNm: 455,
      spotSizeMm: { x: 0.16, y: 0.18 },
      focusLengthMm: 40,
      focusMode: 'fixed-lever',
      airAssist: 'manual',
      notes: 'Bench notes.',
    },
    cncSubProfile: {
      safeZMm: 5,
      spindleMaxRpm: 11000,
      spindleSpinupSec: 4,
      coolant: 'mist',
      parkXMm: 10,
      parkYMm: 20,
    },
    cameraProfile: {
      id: 'lid-camera',
      name: 'Lid camera',
      deviceId: 'usb-0',
      enabled: false,
      transparency: 0.4,
      resolution: { width: 1920, height: 1080 },
    },
    bedWidth: 380,
    bedHeight: 390,
    maxFeed: 5000,
    maxPowerS: 255,
    minPowerS: 5,
    laserModeEnabled: false,
    airAssistCommand: 'M7',
    airAssistRestartUnreliable: true,
    scanningOffsets: [
      { speedMmPerMin: 1000, offsetMm: 0.05 },
      { speedMmPerMin: 4000, offsetMm: 0.2 },
    ],
    bidirectionalScanPolicy: 'require-verified-offsets',
    scanOffsetCalibrationStatus: 'verified',
    controlledLaserOffTravelFeedMmPerMin: 700,
    cameraCalibration: {
      intrinsics: { fx: 1200, fy: 1198, cx: 960, cy: 540 },
      distortion: [0.3, -0.05, 0.01, -0.002],
      imageWidth: 1920,
      imageHeight: 1080,
      rmsPx: 0.24,
      calibratedAt: 1_750_000_000_000,
    },
    cameraAlignment: {
      homography: [0.25, 0.01, 12, -0.02, 0.24, 8, 0.0001, 0, 1],
      frameWidth: 1920,
      frameHeight: 1080,
      basis: 'rectified',
      alignedAt: 1_750_000_000_001,
    },
    noGoZones: [{ id: 'clamp', name: 'Clamp', enabled: true, x: 5, y: 6, width: 20, height: 10 }],
    zTravelMm: 70,
    zTravelConfirmed: true,
    zProbePresent: false,
    rotary: { enabled: true, type: 'chuck', mmPerRotation: 120, objectDiameterMm: 50 },
    fireControl: { enabled: true, maxPowerPercent: 1 },
    framingFeedMmPerMin: 1500,
    accelMmPerSec2: 700,
    junctionDeviationMm: 0.02,
    estimateCutTimeScale: 1.2,
    estimateTravelTimeScale: 0.9,
    origin: 'rear-left',
    homing: { enabled: true, direction: 'rear-left' },
    autofocusCommand: '$HZ1',
  };
}

/** `$$` rows as the settings reader produces them. */
export function settingRows(
  values: Readonly<Record<number, string>>,
): ReadonlyArray<GrblSettingRow> {
  return settingsMapToRows(
    new Map(Object.entries(values).map(([id, value]) => [Number(id), value])),
  );
}

/** Identity settings typical of a 400 x 400 mm GRBL router. */
export const ROUTER_SETTINGS: Readonly<Record<number, string>> = {
  3: '0',
  22: '1',
  23: '3',
  30: '1000',
  31: '0',
  32: '0',
  100: '800.000',
  101: '800.000',
  102: '800.000',
  110: '3000.000',
  130: '400.000',
  131: '400.000',
  132: '75.000',
};

/** A diode laser on a different frame. */
export const LASER_SETTINGS: Readonly<Record<number, string>> = {
  ...ROUTER_SETTINGS,
  32: '1',
  100: '80.000',
  101: '80.000',
  130: '358.000',
  131: '268.000',
};
