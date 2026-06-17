import type {
  MaterialRecipeConfidence,
  MaterialRecipeOperation,
} from '../../core/material-library';

const RECIPE_CONFIDENCES = ['starter', 'calibrated', 'imported', 'unsupported'] as const;
const RECIPE_OPERATIONS = [
  'cut',
  'engrave',
  'score',
  'image',
  'material-test',
  'interval-test',
] as const;

export type MaterialPresetMatchMetadata = {
  readonly material?: string;
  readonly operation?: MaterialRecipeOperation;
  readonly profileId?: string;
  readonly machineFamily?: string;
  readonly laserModel?: string;
  readonly opticalPowerW?: number;
  readonly confidence?: MaterialRecipeConfidence;
  readonly warning?: string;
  readonly calibrationProvenance?: string;
};

export function parsePresetMatchMetadata(
  value: Record<string, unknown>,
  index: number,
):
  | { readonly kind: 'ok'; readonly metadata: MaterialPresetMatchMetadata }
  | { readonly kind: 'invalid'; readonly reason: string } {
  const strings = parseMetadataStrings(value, index);
  if (strings.kind === 'invalid') return strings;
  const enums = parseMetadataEnums(value, index);
  if (enums.kind === 'invalid') return enums;
  const opticalPower = parseOpticalPower(value, index);
  if (opticalPower.kind === 'invalid') return opticalPower;
  return {
    kind: 'ok',
    metadata: { ...strings.metadata, ...enums.metadata, ...opticalPower.metadata },
  };
}

function parseMetadataStrings(
  value: Record<string, unknown>,
  index: number,
):
  | { readonly kind: 'ok'; readonly metadata: MaterialPresetMatchMetadata }
  | { readonly kind: 'invalid'; readonly reason: string } {
  const metadata: Record<string, string> = {};
  for (const field of [
    'material',
    'profileId',
    'machineFamily',
    'laserModel',
    'warning',
    'calibrationProvenance',
  ] as const) {
    const raw = value[field];
    if (raw === undefined) continue;
    if (!isNonEmptyString(raw)) return invalidPresetMetadata(index, field);
    metadata[field] = raw;
  }
  return { kind: 'ok', metadata };
}

function parseMetadataEnums(
  value: Record<string, unknown>,
  index: number,
):
  | { readonly kind: 'ok'; readonly metadata: MaterialPresetMatchMetadata }
  | { readonly kind: 'invalid'; readonly reason: string } {
  let operation: MaterialRecipeOperation | undefined;
  let confidence: MaterialRecipeConfidence | undefined;
  if (value['operation'] !== undefined) {
    if (!isRecipeOperation(value['operation'])) return invalidPresetMetadata(index, 'operation');
    operation = value['operation'];
  }
  if (value['confidence'] !== undefined) {
    if (!isRecipeConfidence(value['confidence'])) return invalidPresetMetadata(index, 'confidence');
    confidence = value['confidence'];
  }
  return {
    kind: 'ok',
    metadata: {
      ...(operation !== undefined ? { operation } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    },
  };
}

function parseOpticalPower(
  value: Record<string, unknown>,
  index: number,
):
  | { readonly kind: 'ok'; readonly metadata: MaterialPresetMatchMetadata }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (value['opticalPowerW'] === undefined) return { kind: 'ok', metadata: {} };
  if (!isPositiveFinite(value['opticalPowerW'])) {
    return invalidPresetMetadata(index, 'opticalPowerW');
  }
  return { kind: 'ok', metadata: { opticalPowerW: value['opticalPowerW'] } };
}

function invalidPresetMetadata(
  index: number,
  field: string,
): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason: `entries[${index}].${field} is invalid` };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecipeConfidence(value: unknown): value is MaterialRecipeConfidence {
  return RECIPE_CONFIDENCES.some((confidence) => confidence === value);
}

function isRecipeOperation(value: unknown): value is MaterialRecipeOperation {
  return RECIPE_OPERATIONS.some((operation) => operation === value);
}
