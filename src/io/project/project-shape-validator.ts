import { validateLayerSubLayers } from './project-layer-validator';
import {
  firstError,
  isObject,
  optionalBoolean,
  optionalDither,
  optionalLiteral,
  optionalNonNegativeNumber,
  optionalNumber,
  optionalPercent,
  optionalPositiveInteger,
  optionalPositiveNumber,
  optionalString,
  requireBoolean,
  requireCoordinate,
  requireDither,
  requireLiteral,
  requireNumber,
  requireOrigin,
  requirePercent,
  requirePositiveInteger,
  requirePositiveNumber,
  requireScale,
  requireString,
  validateArray,
} from './project-validator-primitives';

// Hard ceiling on a stored raster's own (source) pixel grid, checked at .lf2
// deserialize. Distinct from the TARGET burn-grid budget (core/raster
// MAX_RASTER_PIXELS): compile-job allocates the source luma buffer as
// pixelWidth*pixelHeight (decodeBase64Luma / whiteLuma) BEFORE that budget runs,
// so a hand-edited .lf2 with absurd dims (e.g. 2^30 x 1) could allocate
// gigabytes here first. 256M px is far above any real import (2048-edge cap) or
// Convert-to-Bitmap source, but fatal to the integer bomb (security audit 2026-06-14).
const MAX_RASTER_SOURCE_PIXELS = 256_000_000;

export function validateProjectShape(raw: Record<string, unknown>): string | null {
  const device = raw['device'];
  if (!isObject(device)) return 'missing or invalid `device`';
  const workspace = raw['workspace'];
  if (!isObject(workspace)) return 'missing or invalid `workspace`';
  const scene = raw['scene'];
  if (!isObject(scene)) return 'missing or invalid `scene`';
  if (!Array.isArray(scene['objects'])) return 'missing or invalid `scene.objects`';
  if (!Array.isArray(scene['layers'])) return 'missing or invalid `scene.layers`';
  return firstError([
    validateDevice(device),
    validateWorkspace(workspace),
    validateOptimization(raw['optimization']),
    validateScene(scene),
  ]);
}

function validateOptimization(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return 'missing or invalid `optimization`';
  return optionalBoolean(value, 'optimization.reduceTravelMoves');
}

function validateDevice(device: Record<string, unknown>): string | null {
  return firstError([
    requireString(device, 'device.name'),
    requirePositiveNumber(device, 'device.bedWidth'),
    requirePositiveNumber(device, 'device.bedHeight'),
    requirePositiveNumber(device, 'device.maxFeed'),
    requirePositiveNumber(device, 'device.maxPowerS'),
    requireOrigin(device, 'device.origin'),
    validateHoming(device['homing']),
    requireString(device, 'device.autofocusCommand'),
    optionalLiteral(device, 'device.airAssistCommand', ['none', 'M7', 'M8']),
    optionalNonNegativeNumber(device, 'device.minPowerS'),
    optionalBoolean(device, 'device.laserModeEnabled'),
    optionalPositiveNumber(device, 'device.framingFeedMmPerMin'),
    optionalPositiveNumber(device, 'device.accelMmPerSec2'),
    optionalPositiveNumber(device, 'device.junctionDeviationMm'),
  ]);
}

function validateHoming(value: unknown): string | null {
  if (!isObject(value)) return 'missing or invalid `device.homing`';
  return firstError([
    requireBoolean(value, 'device.homing.enabled'),
    requireOrigin(value, 'device.homing.direction'),
  ]);
}

function validateWorkspace(workspace: Record<string, unknown>): string | null {
  return firstError([
    requirePositiveNumber(workspace, 'workspace.width'),
    requirePositiveNumber(workspace, 'workspace.height'),
    requireLiteral(workspace, 'workspace.units', ['mm']),
  ]);
}

function validateScene(scene: Record<string, unknown>): string | null {
  const layers = scene['layers'];
  const objects = scene['objects'];
  if (!Array.isArray(objects) || !Array.isArray(layers)) return null;
  return (
    validateArray(layers, 'scene.layers', validateLayer) ??
    validateArray(objects, 'scene.objects', validateSceneObject)
  );
}

function validateLayer(layer: unknown, path: string): string | null {
  if (!isObject(layer)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(layer, `${path}.id`),
    requireString(layer, `${path}.color`),
    requireLiteral(layer, `${path}.mode`, ['line', 'fill', 'image']),
    optionalPercent(layer, `${path}.minPower`),
    requirePercent(layer, `${path}.power`),
    requirePositiveNumber(layer, `${path}.speed`),
    requirePositiveInteger(layer, `${path}.passes`),
    requireBoolean(layer, `${path}.visible`),
    requireBoolean(layer, `${path}.output`),
    optionalBoolean(layer, `${path}.airAssist`),
    optionalNumber(layer, `${path}.kerfOffsetMm`),
    optionalBoolean(layer, `${path}.tabsEnabled`),
    optionalPositiveNumber(layer, `${path}.tabSizeMm`),
    optionalPositiveInteger(layer, `${path}.tabsPerShape`),
    optionalBoolean(layer, `${path}.tabSkipInnerShapes`),
    optionalNumber(layer, `${path}.hatchAngleDeg`),
    optionalPositiveNumber(layer, `${path}.hatchSpacingMm`),
    optionalNonNegativeNumber(layer, `${path}.fillOverscanMm`),
    optionalLiteral(layer, `${path}.fillStyle`, ['scanline', 'offset']),
    optionalBoolean(layer, `${path}.fillBidirectional`),
    optionalBoolean(layer, `${path}.fillCrossHatch`),
    optionalDither(layer, `${path}.ditherAlgorithm`),
    optionalPositiveNumber(layer, `${path}.linesPerMm`),
    optionalBoolean(layer, `${path}.imageBidirectional`),
    optionalBoolean(layer, `${path}.negativeImage`),
    optionalBoolean(layer, `${path}.passThrough`),
    optionalNonNegativeNumber(layer, `${path}.dotWidthCorrectionMm`),
    validateLayerSubLayers(layer['subLayers'], `${path}.subLayers`),
  ]);
}

function validateSceneObject(obj: unknown, path: string): string | null {
  if (!isObject(obj)) return `missing or invalid \`${path}\``;
  const kind = obj['kind'];
  if (kind === 'imported-svg') return validateVectorObject(obj, path);
  if (kind === 'text') return validateTextObject(obj, path);
  if (kind === 'traced-image') return validateVectorObject(obj, path);
  if (kind === 'raster-image') return validateRasterObject(obj, path);
  if (kind === 'shape') return validateShapeObject(obj, path);
  return `missing or invalid \`${path}.kind\``;
}

function validateVectorObject(obj: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireString(obj, `${path}.id`),
    requireString(obj, `${path}.source`),
    optionalPercent(obj, `${path}.powerScale`),
    validateBounds(obj['bounds'], `${path}.bounds`),
    validateTransform(obj['transform'], `${path}.transform`),
    validateColoredPaths(obj['paths'], `${path}.paths`),
  ]);
}

function validateTextObject(obj: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireString(obj, `${path}.id`),
    requireString(obj, `${path}.content`),
    requireString(obj, `${path}.fontKey`),
    requirePositiveNumber(obj, `${path}.sizeMm`),
    requireLiteral(obj, `${path}.alignment`, ['left', 'center', 'right']),
    requirePositiveNumber(obj, `${path}.lineHeight`),
    optionalPercent(obj, `${path}.powerScale`),
    optionalNumber(obj, `${path}.letterSpacing`),
    requireString(obj, `${path}.color`),
    validateBounds(obj['bounds'], `${path}.bounds`),
    validateTransform(obj['transform'], `${path}.transform`),
    validateColoredPaths(obj['paths'], `${path}.paths`),
  ]);
}

function validateRasterObject(obj: Record<string, unknown>, path: string): string | null {
  const fieldError = firstError([
    requireString(obj, `${path}.id`),
    requireString(obj, `${path}.source`),
    requireString(obj, `${path}.dataUrl`),
    requirePositiveInteger(obj, `${path}.pixelWidth`),
    requirePositiveInteger(obj, `${path}.pixelHeight`),
    optionalPercent(obj, `${path}.powerScale`),
    validateBounds(obj['bounds'], `${path}.bounds`),
    validateTransform(obj['transform'], `${path}.transform`),
    requireString(obj, `${path}.color`),
    requireDither(obj, `${path}.dither`),
    requirePositiveNumber(obj, `${path}.linesPerMm`),
    optionalNumber(obj, `${path}.brightness`),
    optionalNumber(obj, `${path}.contrast`),
    optionalNumber(obj, `${path}.gamma`),
    optionalString(obj, `${path}.lumaBase64`),
    optionalLiteral(obj, `${path}.role`, ['trace-source']),
  ]);
  if (fieldError !== null) return fieldError;
  // Cross-field DoS guard: bound the source luma allocation (see
  // MAX_RASTER_SOURCE_PIXELS). pixelWidth/pixelHeight are validated positive
  // integers above, so the typeof guards only satisfy the type checker.
  const pixelWidth = obj['pixelWidth'];
  const pixelHeight = obj['pixelHeight'];
  if (
    typeof pixelWidth === 'number' &&
    typeof pixelHeight === 'number' &&
    pixelWidth * pixelHeight > MAX_RASTER_SOURCE_PIXELS
  ) {
    return `invalid \`${path}\`: pixelWidth*pixelHeight exceeds ${MAX_RASTER_SOURCE_PIXELS}`;
  }
  return null;
}

function validateShapeObject(obj: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireString(obj, `${path}.id`),
    validateShapeSpec(obj['spec'], `${path}.spec`),
    requireString(obj, `${path}.color`),
    optionalPercent(obj, `${path}.powerScale`),
    validateBounds(obj['bounds'], `${path}.bounds`),
    validateTransform(obj['transform'], `${path}.transform`),
    validateColoredPaths(obj['paths'], `${path}.paths`),
  ]);
}

// Phase G (ADR-051). One arm today (rect); ellipse / polygon / polyline add arms
// here as core/shapes grows.
function validateShapeSpec(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const kind = value['kind'];
  if (kind === 'rect') {
    return firstError([
      requirePositiveNumber(value, `${path}.widthMm`),
      requirePositiveNumber(value, `${path}.heightMm`),
      requireNumber(value, `${path}.cornerRadiusMm`),
    ]);
  }
  if (kind === 'ellipse') {
    return firstError([
      requirePositiveNumber(value, `${path}.widthMm`),
      requirePositiveNumber(value, `${path}.heightMm`),
    ]);
  }
  if (kind === 'polygon') {
    return firstError([
      requirePositiveInteger(value, `${path}.sides`),
      requirePositiveNumber(value, `${path}.radiusMm`),
    ]);
  }
  if (kind === 'polyline') {
    // Empty points are accepted (they round-trip to a no-op render), matching
    // how validatePolyline tolerates empty ColoredPath polylines.
    return firstError([
      validatePoints(value['points'], `${path}.points`),
      requireBoolean(value, `${path}.closed`),
    ]);
  }
  return `missing or invalid \`${path}.kind\``;
}

function validateBounds(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const fieldError = firstError([
    requireCoordinate(value, `${path}.minX`),
    requireCoordinate(value, `${path}.minY`),
    requireCoordinate(value, `${path}.maxX`),
    requireCoordinate(value, `${path}.maxY`),
  ]);
  if (fieldError !== null) return fieldError;
  // Cross-field invariant (CQ-006): bounds are normalized (min <= max) by
  // construction, so an inverted bound is a corrupt/hand-edited .lf2. Reject it
  // to the "Could not open" modal instead of loading a negative-extent object.
  // `<=` keeps zero-extent bounds valid (a single point / axis-aligned line).
  const { minX, minY, maxX, maxY } = value;
  if (typeof minX === 'number' && typeof maxX === 'number' && minX > maxX) {
    return `invalid \`${path}\`: minX must be <= maxX`;
  }
  if (typeof minY === 'number' && typeof maxY === 'number' && minY > maxY) {
    return `invalid \`${path}\`: minY must be <= maxY`;
  }
  return null;
}

function validateTransform(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireCoordinate(value, `${path}.x`),
    requireCoordinate(value, `${path}.y`),
    requireScale(value, `${path}.scaleX`),
    requireScale(value, `${path}.scaleY`),
    requireNumber(value, `${path}.rotationDeg`),
    requireBoolean(value, `${path}.mirrorX`),
    requireBoolean(value, `${path}.mirrorY`),
  ]);
}

function validateColoredPaths(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validateColoredPath);
}

function validateColoredPath(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireString(value, `${path}.color`),
    validatePolylines(value['polylines'], `${path}.polylines`),
  ]);
}

function validatePolylines(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validatePolyline);
}

function validatePolyline(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([
    requireBoolean(value, `${path}.closed`),
    validatePoints(value['points'], `${path}.points`),
  ]);
}

function validatePoints(value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, validatePoint);
}

function validatePoint(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  return firstError([requireCoordinate(value, `${path}.x`), requireCoordinate(value, `${path}.y`)]);
}
