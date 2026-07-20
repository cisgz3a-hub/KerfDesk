import { isKnownControllerKind } from '../../../core/devices';
import {
  MAX_RAW_LINE_CHARS,
  MAX_RAW_LINES,
  isBoundedString,
  isBoundedStringArray,
  isFiniteNonNegative,
  isPositiveInteger,
  isRecord,
  isSafeNonNegativeInteger,
} from './execution-provenance-validation-helpers';

const MAX_SETTINGS_ROWS = 2_048;
const STOCK_GRBL_OPTION_ORDER = 'VNMCPZHTAD0SRL+*$#IEW2';
const STOCK_GRBL_OPTIONS = new Set(STOCK_GRBL_OPTION_ORDER.split(''));

export function hasValidController(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isSafeNonNegativeInteger(value['sessionEpoch'])) return false;
  if (!isKnownControllerKind(value['activeKind'])) return false;
  if (!hasValidDetectedKind(value['detectedKind'])) return false;
  if (!hasValidQualification(value['qualification'])) return false;
  if (!hasValidBuildObservation(value['buildInfo'])) return false;
  if (!hasValidNullableObservation(value['settingsObservation'])) return false;
  if (!hasValidSettingsRows(value['settingsRows'])) return false;
  return controllerEpochsMatch(value);
}

function hasValidDetectedKind(value: unknown): boolean {
  return value === null || isKnownControllerKind(value);
}

function hasValidQualification(value: unknown): boolean {
  if (!isRecord(value) || !isSafeNonNegativeInteger(value['epoch'])) return false;
  switch (value['kind']) {
    case 'disconnected':
      return hasNoPhaseOrSettings(value);
    case 'qualifying':
      return hasValidQualifyingFields(value);
    case 'qualified':
      return hasValidQualifiedFields(value);
    case 'failed':
      return isBoundedString(value['message'], 1) && value['phase'] === undefined;
    default:
      return false;
  }
}

function hasNoPhaseOrSettings(value: Record<string, unknown>): boolean {
  return value['phase'] === undefined && value['settings'] === undefined;
}

function hasValidQualifyingFields(value: Record<string, unknown>): boolean {
  const phases = ['controller-response', 'reset-cleanup', 'settings-read'];
  return phases.includes(String(value['phase'])) && value['settings'] === undefined;
}

function hasValidQualifiedFields(value: Record<string, unknown>): boolean {
  const settings = value['settings'];
  return (settings === 'verified' || settings === 'not-required') && value['phase'] === undefined;
}

function hasValidBuildObservation(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (value['parsed'] !== null && !hasValidGrblBuildInfo(value['parsed'])) return false;
  if (!isBoundedStringArray(value['rawLines'], MAX_RAW_LINES, MAX_RAW_LINE_CHARS)) return false;
  return hasValidObservation(value['observation']);
}

export function hasValidGrblBuildInfo(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isBoundedString(value['protocolVersion'], 1)) return false;
  if (!isBoundedString(value['buildRevision'], 1)) return false;
  if (!isBoundedString(value['userInfo'], 0)) return false;
  const options = value['optionCodes'];
  if (!Array.isArray(options) || options.length > 64) return false;
  if (!options.every(isStockGrblOption)) return false;
  if (!optionsAreCanonical(options)) return false;
  return (
    isPositiveInteger(value['plannerBufferBlocks']) && isPositiveInteger(value['rxBufferBytes'])
  );
}

function isStockGrblOption(value: unknown): boolean {
  return typeof value === 'string' && STOCK_GRBL_OPTIONS.has(value);
}

function optionsAreCanonical(options: ReadonlyArray<unknown>): boolean {
  let previousIndex = -1;
  for (const option of options) {
    if (typeof option !== 'string') return false;
    const index = STOCK_GRBL_OPTION_ORDER.indexOf(option);
    if (index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

export function hasValidNullableObservation(value: unknown): boolean {
  return value === null || hasValidObservation(value);
}

function hasValidObservation(value: unknown): boolean {
  return (
    isRecord(value) &&
    isSafeNonNegativeInteger(value['sessionEpoch']) &&
    isFiniteNonNegative(value['observedAt'])
  );
}

function hasValidSettingsRows(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_SETTINGS_ROWS) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
    if (!hasValidSettingsRow(value[index])) return false;
  }
  return true;
}

function hasValidSettingsRow(value: unknown): boolean {
  if (!isRecord(value) || typeof value['code'] !== 'string') return false;
  return /^\$\d+$/.test(value['code']) && isBoundedString(value['rawValue'], 0, MAX_RAW_LINE_CHARS);
}

function controllerEpochsMatch(controller: Record<string, unknown>): boolean {
  const sessionEpoch = controller['sessionEpoch'];
  const qualification = controller['qualification'];
  if (!isRecord(qualification) || qualification['epoch'] !== sessionEpoch) return false;
  if (!observationEpochMatches(controller['buildInfo'], sessionEpoch, 'build')) return false;
  return observationEpochMatches(controller['settingsObservation'], sessionEpoch, 'direct');
}

function observationEpochMatches(
  value: unknown,
  sessionEpoch: unknown,
  kind: 'build' | 'direct',
): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const observation = kind === 'build' ? value['observation'] : value;
  return isRecord(observation) && observation['sessionEpoch'] === sessionEpoch;
}
