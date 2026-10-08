import type { ImportedSvg, SceneObject } from './scene-object';

export type BooleanCompoundOperation = 'weld' | 'subtract' | 'intersect' | 'exclude';
export type BooleanCompoundOperand = {
  /** Original artwork identity. Weld can retain several operation fragments of it. */
  readonly sourceId: string;
  readonly sourceKind: 'imported-svg' | 'traced-image' | 'shape' | 'text';
  readonly object: ImportedSvg;
};
/** Retained local sources; only the containing result belongs to scene/output. */
export type BooleanCompound = {
  readonly operation: BooleanCompoundOperation;
  readonly operands: ReadonlyArray<BooleanCompoundOperand>;
};
export const MAX_BOOLEAN_COMPOUND_OPERANDS = 1000;

export function isBooleanCompoundObject(object: {
  readonly kind: string;
}): object is ImportedSvg & { readonly booleanCompound: BooleanCompound } {
  return (
    object.kind === 'imported-svg' &&
    'booleanCompound' in object &&
    object.booleanCompound !== undefined
  );
}

export function validateBooleanCompound(
  value: unknown,
  path: string,
  validateOperand: (object: unknown, path: string) => string | null,
): string | null {
  if (value === undefined) return null;
  if (
    !record(value) ||
    typeof value['operation'] !== 'string' ||
    !['weld', 'subtract', 'intersect', 'exclude'].includes(value['operation'])
  )
    return `invalid ${path}.operation`;
  const operands = value['operands'];
  if (
    !Array.isArray(operands) ||
    operands.length < 2 ||
    operands.length > MAX_BOOLEAN_COMPOUND_OPERANDS
  )
    return `invalid ${path}.operands: retain 2 to ${MAX_BOOLEAN_COMPOUND_OPERANDS} fragments`;
  const ids = new Set<string>();
  for (let index = 0; index < operands.length; index += 1) {
    const error = validateCompoundOperand(
      operands[index],
      `${path}.operands[${index}]`,
      validateOperand,
      ids,
    );
    if (error !== null) return error;
  }
  return null;
}
function validateCompoundOperand(
  value: unknown,
  at: string,
  validate: (object: unknown, path: string) => string | null,
  ids: Set<string>,
): string | null {
  if (!record(value) || typeof value['sourceId'] !== 'string' || value['sourceId'].trim() === '')
    return `invalid ${at}.sourceId`;
  if (!isCompoundSourceKind(value['sourceKind'])) return `invalid ${at}.sourceKind`;
  const object = value['object'];
  if (
    !record(object) ||
    object['kind'] !== 'imported-svg' ||
    object['booleanCompound'] !== undefined
  )
    return `invalid ${at}.object: operands must be non-recursive paths`;
  const error = validate(object, `${at}.object`);
  if (error !== null) return error;
  const id = object['id'];
  if (typeof id !== 'string' || id.trim() === '' || ids.has(id))
    return `invalid ${at}.object.id: operand identities must be unique`;
  ids.add(id);
  return null;
}
function isCompoundSourceKind(value: unknown): value is BooleanCompoundOperand['sourceKind'] {
  return (
    typeof value === 'string' && ['imported-svg', 'traced-image', 'shape', 'text'].includes(value)
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function retainedBooleanOperandCount(objects: ReadonlyArray<SceneObject>): number {
  return objects.reduce(
    (sum, object) =>
      sum + (isBooleanCompoundObject(object) ? object.booleanCompound.operands.length : 0),
    0,
  );
}
