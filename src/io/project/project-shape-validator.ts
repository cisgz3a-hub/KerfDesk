import { DITHER_ALGORITHMS, RELIEF_EMBED_TRIANGLE_LIMIT } from '../../core/scene';
import { isScanOffsetTable } from '../../core/devices';
import * as profileField from './project-device-profile-validator';
import { validateProjectLayer } from './project-layer-shape-validator';
import { validateCurveSubpaths } from './project-curve-shape-validator';
import { validateObjectOperationOverride } from './project-operation-override-validator';
import { validateOptimization } from './project-optimization-validator';
import { validateProjectVariables, validateVariableTemplate } from './project-variable-validator';
import { validateRasterLumaBase64 } from './project-raster-luma-validator';
import { validatePrintAndCutTargets } from './project-print-and-cut-validator';
import { validatePathText } from './project-path-text-validator';
import { validateEmbeddedFonts } from './project-embedded-font-validator';
import { validateSceneBudgets, validateSceneIntegrity } from './project-scene-integrity-validator';
import { validateCncTabAnchors } from './project-cnc-tab-validator';
import { validateOptionalArtworkOrder } from './project-artwork-order-validator';
import { validateTracedImageMetadata } from './project-trace-shape-validator';
import {
  firstError,
  isObject,
  optionalBoolean,
  optionalLiteral,
  optionalNonNegativeNumber,
  optionalNumber,
  optionalPercent,
  optionalPositiveNumber,
  optionalString,
  requireBoolean,
  requireCoordinate,
  requireIntegerInRange,
  requireLiteral,
  requireNumber,
  requirePositiveInteger,
  requirePositiveNumber,
  requireScale,
  requireString,
  requireUnitRatio,
  validateArray,
  valueAtPath,
} from './project-shape-primitives';

// Bound source allocation before the target burn-grid budget runs. 256M pixels
// remains far above real imports while blocking hand-edited allocation bombs.
const MAX_RASTER_SOURCE_PIXELS = 256_000_000;
const ORIGINS = ['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const;

// which the G-code bounds-check regex can't read — defeating the bounds
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
    validateProjectVariables(raw['variables']),
    validatePrintAndCutTargets(raw['printAndCutTargets']),
    validateEmbeddedFonts(raw['embeddedFonts']),
    optionalString(raw, 'notes'),
    validateScene(scene),
  ]);
}

function validateDevice(device: Record<string, unknown>): string | null {
  return firstError([
    requireString(device, 'device.name'),
    requirePositiveNumber(device, 'device.bedWidth'),
    requirePositiveNumber(device, 'device.bedHeight'),
    requirePositiveNumber(device, 'device.maxFeed'),
    requirePositiveNumber(device, 'device.maxPowerS'),
    requireLiteral(device, 'device.origin', ORIGINS),
    validateHoming(device['homing']),
    requireString(device, 'device.autofocusCommand'),
    optionalLiteral(device, 'device.airAssistCommand', ['none', 'M7', 'M8']),
    optionalLiteral(device, 'device.streamingMode', ['char-counted', 'ping-pong']),
    profileField.optionalGrblRxBufferBytes(device, 'device.rxBufferBytes'),
    profileField.optionalGcodeDialect(device, 'device.gcodeDialect'),
    optionalNonNegativeNumber(device, 'device.minPowerS'),
    optionalBoolean(device, 'device.laserModeEnabled'),
    profileField.optionalProfileCapabilities(device, 'device.capabilities'),
    profileField.optionalLaserSubProfile(device, 'device.laserSubProfile'),
    profileField.optionalCameraProfile(device, 'device.cameraProfile'),
    optionalScanOffsetTable(device, 'device.scanningOffsets'),
    profileField.optionalNoGoZones(device, 'device.noGoZones'),
    optionalPositiveNumber(device, 'device.zTravelMm'),
    optionalBoolean(device, 'device.zTravelConfirmed'),
    optionalBoolean(device, 'device.zProbePresent'),
    optionalPositiveNumber(device, 'device.framingFeedMmPerMin'),
    optionalPositiveNumber(device, 'device.accelMmPerSec2'),
    optionalPositiveNumber(device, 'device.junctionDeviationMm'),
    profileField.optionalEstimateTimeScales(device, 'device'),
    profileField.optionalRotarySetup(device, 'device.rotary'),
    profileField.optionalLaserFireControl(device, 'device.fireControl'),
  ]);
}

function validateHoming(value: unknown): string | null {
  if (!isObject(value)) return 'missing or invalid `device.homing`';
  return firstError([
    requireBoolean(value, 'device.homing.enabled'),
    requireLiteral(value, 'device.homing.direction', ORIGINS),
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
    validateSceneBudgets(scene) ??
    validateArray(layers, 'scene.layers', validateProjectLayer) ??
    validateArray(objects, 'scene.objects', validateSceneObject) ??
    validateOptionalArtworkOrder(scene, 'scene.artworkOrder') ??
    optionalSceneGroups(scene, 'scene.groups') ??
    validateSceneIntegrity(scene)
  );
}

function optionalSceneGroups(scene: Record<string, unknown>, path: string): string | null {
  const groups = scene['groups'];
  if (groups === undefined) return null;
  if (!Array.isArray(groups)) return `missing or invalid \`${path}\``;
  return validateArray(groups, path, validateSceneGroup);
}

function validateSceneGroup(value: unknown, path: string): string | null {
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const objectIds = value['objectIds'];
  const fieldError = firstError([
    requireString(value, `${path}.id`),
    requireString(value, `${path}.name`),
    Array.isArray(objectIds)
      ? validateArray(objectIds, `${path}.objectIds`, validateSceneGroupObjectId)
      : `missing or invalid \`${path}.objectIds\``,
  ]);
  if (fieldError !== null) return fieldError;
  return Array.isArray(objectIds) && objectIds.length >= 2
    ? null
    : `missing or invalid \`${path}.objectIds\``;
}

function validateSceneGroupObjectId(value: unknown, path: string): string | null {
  return typeof value === 'string' ? null : `missing or invalid \`${path}\``;
}

function validateSceneObject(obj: unknown, path: string): string | null {
  if (!isObject(obj)) return `missing or invalid \`${path}\``;
  const operationIdsError = validateOperationIds(obj['operationIds'], `${path}.operationIds`);
  if (operationIdsError !== null) return operationIdsError;
  const tabAnchorError = validateCncTabAnchors(obj['cncTabAnchors'], `${path}.cncTabAnchors`);
  if (tabAnchorError !== null) return tabAnchorError;
  const kind = obj['kind'];
  if (kind === 'imported-svg') return validateVectorObject(obj, path);
  if (kind === 'text') return validateTextObject(obj, path);
  if (kind === 'traced-image') {
    return firstError([validateVectorObject(obj, path), validateTracedImageMetadata(obj, path)]);
  }
  if (kind === 'raster-image') return validateRasterObject(obj, path);
  if (kind === 'shape') return validateShapeObject(obj, path);
  if (kind === 'relief') return validateReliefObject(obj, path);
  return `missing or invalid \`${path}.kind\``;
}

// H.4 (ADR-098): the embedded mesh is the carving source — a malformed or
// non-finite mesh must never reach the heightmap sampler.
function validateReliefObject(obj: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireString(obj, `${path}.id`),
    requireString(obj, `${path}.source`),
    validateMeshPositions(obj['meshPositions'], `${path}.meshPositions`),
    requirePositiveNumber(obj, `${path}.targetWidthMm`),
    requirePositiveNumber(obj, `${path}.reliefDepthMm`),
    requireLiteral(obj, `${path}.emptyCells`, ['floor', 'top']),
    requireString(obj, `${path}.color`),
    optionalPercent(obj, `${path}.powerScale`),
    validateObjectOperationOverride(obj['operationOverride'], `${path}.operationOverride`),
    optionalBoolean(obj, `${path}.locked`),
    validateBounds(obj['bounds'], `${path}.bounds`),
    validateTransform(obj['transform'], `${path}.transform`),
  ]);
}

function validateMeshPositions(value: unknown, path: string): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return `missing or invalid \`${path}\``;
  }
  if (value.length % 9 !== 0) {
    return `\`${path}\` length must be a multiple of 9 (three xyz vertices per triangle)`;
  }
  if (value.length > RELIEF_EMBED_TRIANGLE_LIMIT * 9) {
    return `\`${path}\` exceeds the ${RELIEF_EMBED_TRIANGLE_LIMIT}-triangle embed limit`;
  }
  for (const n of value) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return `non-finite number in \`${path}\``;
    }
  }
  return null;
}

function validateVectorObject(obj: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireString(obj, `${path}.id`),
    requireString(obj, `${path}.source`),
    optionalPercent(obj, `${path}.powerScale`),
    validateObjectOperationOverride(obj['operationOverride'], `${path}.operationOverride`),
    optionalBoolean(obj, `${path}.locked`),
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
    validateObjectOperationOverride(obj['operationOverride'], `${path}.operationOverride`),
    optionalBoolean(obj, `${path}.locked`),
    optionalNumber(obj, `${path}.letterSpacing`),
    optionalNumber(obj, `${path}.bendDeg`),
    validatePathText(obj['pathText'], `${path}.pathText`),
    validateVariableTemplate(obj['variableTemplate'], `${path}.variableTemplate`),
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
    optionalString(obj, `${path}.traceSourceId`),
    requireString(obj, `${path}.dataUrl`),
    requirePositiveInteger(obj, `${path}.pixelWidth`),
    requirePositiveInteger(obj, `${path}.pixelHeight`),
    optionalPercent(obj, `${path}.powerScale`),
    validateObjectOperationOverride(obj['operationOverride'], `${path}.operationOverride`),
    optionalBoolean(obj, `${path}.locked`),
    validateBounds(obj['bounds'], `${path}.bounds`),
    validateTransform(obj['transform'], `${path}.transform`),
    requireString(obj, `${path}.color`),
    requireLiteral(obj, `${path}.dither`, DITHER_ALGORITHMS),
    requirePositiveNumber(obj, `${path}.linesPerMm`),
    optionalNumber(obj, `${path}.brightness`),
    optionalNumber(obj, `${path}.contrast`),
    optionalNumber(obj, `${path}.gamma`),
    optionalString(obj, `${path}.imageMaskId`),
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
  const lumaBase64 = obj['lumaBase64'];
  if (
    typeof pixelWidth === 'number' &&
    typeof pixelHeight === 'number' &&
    typeof lumaBase64 === 'string'
  ) {
    return validateRasterLumaBase64(lumaBase64, pixelWidth * pixelHeight, path);
  }
  return null;
}

function validateShapeObject(obj: Record<string, unknown>, path: string): string | null {
  return firstError([
    requireString(obj, `${path}.id`),
    validateShapeSpec(obj['spec'], `${path}.spec`),
    requireString(obj, `${path}.color`),
    optionalPercent(obj, `${path}.powerScale`),
    validateObjectOperationOverride(obj['operationOverride'], `${path}.operationOverride`),
    optionalBoolean(obj, `${path}.locked`),
    optionalLiteral(obj, `${path}.provenance`, ['captured-board', 'jig']),
    optionalNonNegativeNumber(obj, `${path}.fairingVersion`),
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
  if (kind === 'star') {
    return firstError([
      requireIntegerInRange(value, `${path}.points`, 3, 64),
      requirePositiveNumber(value, `${path}.outerRadiusMm`),
      requireUnitRatio(value, `${path}.innerRadiusRatio`),
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
    validateOperationIds(value['operationIds'], `${path}.operationIds`),
    validatePolylines(value['polylines'], `${path}.polylines`),
    validateCurveSubpaths(value['curves'], `${path}.curves`),
  ]);
}

function validateOperationIds(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, (id, idPath) =>
    typeof id === 'string' && id.length > 0 ? null : `missing or invalid \`${idPath}\``,
  );
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

function optionalScanOffsetTable(obj: Record<string, unknown>, path: string): string | null {
  const value = valueAtPath(obj, path);
  return value === undefined || isScanOffsetTable(value) ? null : `missing or invalid \`${path}\``;
}
