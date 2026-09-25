// Where a project's copy of a machine differs from the saved machine it names
// (ADR-374). Every DeviceProfile field is classified below, so a field added
// later does not compile until someone decides which difference it belongs to;
// a switched or reconciled machine can never quietly keep one it forgot.

import type { DeviceProfile } from '../devices';

export type SavedMachineDifference =
  | 'Machine type'
  | 'Work area'
  | 'Origin and homing'
  | 'Controller and connection'
  | 'Power and laser mode'
  | 'Speeds and motion'
  | 'Air assist'
  | 'Scan offsets'
  | 'Camera'
  | 'No-go zones'
  | 'Rotary'
  | 'Laser head'
  | 'CNC settings'
  | 'Z axis'
  | 'Auto-focus';

const CONTROLLER = 'Controller and connection';
const SPEEDS = 'Speeds and motion';
const POWER = 'Power and laser mode';
const ORIGIN = 'Origin and homing';

// null marks a descriptive label: renaming a copy is not a machine difference.
const FIELD_DIFFERENCES = {
  name: null,
  vendor: null,
  model: null,
  profileSource: null,
  catalogVersion: null,
  evidence: null,
  savedMachineId: null,
  profileId: 'Machine type',
  machineFamily: 'Machine type',
  capabilities: 'Machine type',
  bedWidth: 'Work area',
  bedHeight: 'Work area',
  origin: ORIGIN,
  homing: ORIGIN,
  controllerKind: CONTROLLER,
  controllerCommandSet: CONTROLLER,
  baudRate: CONTROLLER,
  streamingMode: CONTROLLER,
  rxBufferBytes: CONTROLLER,
  workerHostedStreaming: CONTROLLER,
  gcodeDialect: CONTROLLER,
  maxPowerS: POWER,
  minPowerS: POWER,
  laserModeEnabled: POWER,
  fireControl: POWER,
  maxFeed: SPEEDS,
  framingFeedMmPerMin: SPEEDS,
  accelMmPerSec2: SPEEDS,
  junctionDeviationMm: SPEEDS,
  controlledLaserOffTravelFeedMmPerMin: SPEEDS,
  estimateCutTimeScale: SPEEDS,
  estimateTravelTimeScale: SPEEDS,
  airAssistCommand: 'Air assist',
  airAssistRestartUnreliable: 'Air assist',
  scanningOffsets: 'Scan offsets',
  bidirectionalScanPolicy: 'Scan offsets',
  scanOffsetCalibrationStatus: 'Scan offsets',
  cameraProfile: 'Camera',
  cameraCalibration: 'Camera',
  cameraAlignment: 'Camera',
  noGoZones: 'No-go zones',
  rotary: 'Rotary',
  laserSubProfile: 'Laser head',
  cncSubProfile: 'CNC settings',
  zTravelMm: 'Z axis',
  zTravelConfirmed: 'Z axis',
  zProbePresent: 'Z axis',
  autofocusCommand: 'Auto-focus',
} as const satisfies Record<keyof DeviceProfile, SavedMachineDifference | null>;

const DIFFERENCE_ORDER: ReadonlyArray<SavedMachineDifference> = [
  'Machine type',
  'Work area',
  'Origin and homing',
  'Controller and connection',
  'Power and laser mode',
  'Speeds and motion',
  'Air assist',
  'Scan offsets',
  'Camera',
  'No-go zones',
  'Rotary',
  'Laser head',
  'CNC settings',
  'Z axis',
  'Auto-focus',
];

/** The groups of settings where the two profiles disagree, in display order.
 * Empty means the copy matches the saved machine apart from its labels. */
export function savedMachineDifferences(
  projectCopy: DeviceProfile,
  saved: DeviceProfile,
): ReadonlyArray<SavedMachineDifference> {
  const found = new Set<SavedMachineDifference>();
  for (const [field, difference] of Object.entries(FIELD_DIFFERENCES)) {
    if (difference === null || found.has(difference)) continue;
    const key = field as keyof DeviceProfile;
    if (!sameValue(projectCopy[key], saved[key])) found.add(difference);
  }
  return DIFFERENCE_ORDER.filter((difference) => found.has(difference));
}

/** Structural equality where an absent property and an undefined one agree. */
export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return sameArray(left, right);
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameValue(left[key], right[key])) return false;
  }
  return true;
}

function sameArray(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((item, index) => sameValue(item, right[index]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
