import { validateCameraProfileShape } from '../../core/camera';
import {
  HARD_MAX_FIRE_POWER_PERCENT,
  PROFILE_CAPABILITIES,
  type ProfileCapability,
} from '../../core/devices';
import {
  firstError,
  isObject,
  optionalBoolean,
  optionalLiteral,
  optionalPositiveNumber,
  optionalString,
  requireBoolean,
  requireLiteral,
  requireNonNegativeNumber,
  requirePositiveNumber,
  requireString,
  validateArray,
  valueAtPath,
} from './project-shape-primitives';

export function optionalNoGoZones(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validateNoGoZone);
}

export function optionalProfileCapabilities(
  obj: Record<string, unknown>,
  path: string,
): string | null {
  const value = valueAtPath(obj, path);
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => !isProfileCapability(item))) {
    return `missing or invalid \`${path}\``;
  }
  return null;
}

export function optionalLaserSubProfile(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(value, `${path}.model`),
    optionalLiteral(value, `${path}.technology`, ['diode', 'co2', 'fiber', 'unknown']),
    optionalLiteral(value, `${path}.metadataConfidence`, [
      'researched',
      'user-confirmed',
      'imported',
      'unverified',
    ]),
    optionalPositiveNumber(value, `${path}.opticalPowerW`),
    optionalPositiveNumber(value, `${path}.wavelengthNm`),
    optionalLaserSpotSize(value, `${path}.spotSizeMm`),
    optionalPositiveNumber(value, `${path}.focusLengthMm`),
    optionalString(value, `${path}.notes`),
    requireLiteral(value, `${path}.focusMode`, ['fixed-lever', 'manual', 'unknown']),
    requireLiteral(value, `${path}.airAssist`, ['built-in', 'manual', 'none', 'unknown']),
  ]);
}

export function optionalCameraProfile(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined ? null : validateCameraProfileShape(value, path);
}

export function optionalRotarySetup(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireBoolean(value, `${path}.enabled`),
    requireLiteral(value, `${path}.type`, ['roller', 'chuck']),
    requirePositiveNumber(value, `${path}.mmPerRotation`),
    requirePositiveNumber(value, `${path}.objectDiameterMm`),
    optionalBoolean(value, `${path}.reverseAxis`),
  ]);
}

export function optionalLaserFireControl(
  obj: Record<string, unknown>,
  path: string,
): string | null {
  const value = valueAtPath(obj, path);
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const maxPower = valueAtPath(value, `${path}.maxPowerPercent`);
  if (
    typeof maxPower !== 'number' ||
    !Number.isFinite(maxPower) ||
    maxPower <= 0 ||
    maxPower > HARD_MAX_FIRE_POWER_PERCENT
  ) {
    return `missing or invalid \`${path}.maxPowerPercent\``;
  }
  return requireBoolean(value, `${path}.enabled`);
}

function optionalLaserSpotSize(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requirePositiveNumber(value, `${path}.x`),
    requirePositiveNumber(value, `${path}.y`),
  ]);
}

function validateNoGoZone(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(value, `${path}.id`),
    requireString(value, `${path}.name`),
    requireBoolean(value, `${path}.enabled`),
    requireNonNegativeNumber(value, `${path}.x`),
    requireNonNegativeNumber(value, `${path}.y`),
    requirePositiveNumber(value, `${path}.width`),
    requirePositiveNumber(value, `${path}.height`),
  ]);
}

function isProfileCapability(value: unknown): value is ProfileCapability {
  return PROFILE_CAPABILITIES.some((capability) => capability === value);
}
