import { describe, expect, it } from 'vitest';
import { captureBooleanCompound, evaluateBooleanCompound } from './boolean-compound';
import { compoundArea, compoundRectangle } from './boolean-compound.test-fixture';
import { validateBooleanCompound, type BooleanCompoundOperation } from '../scene/boolean-compound';
import type { ImportedSvg, TextObject } from '../scene/scene-object';

function compound(operation: BooleanCompoundOperation): ImportedSvg {
  const captured = captureBooleanCompound(operation, [
    compoundRectangle('subject'),
    compoundRectangle('clip', 5),
  ]);
  if (captured.kind !== 'ok') throw new Error(captured.error.message);
  const result = evaluateBooleanCompound({
    ...compoundRectangle('result'),
    booleanCompound: captured.value,
  });
  if (result.kind !== 'ok') throw new Error(result.error.message);
  return result.value;
}
describe('retained Boolean geometry', () => {
  it.each([
    ['subtract', 50, 80],
    ['intersect', 50, 20],
    ['exclude', 100, 160],
  ] as const)(
    'reevaluates %s from edited sources while preserving owner and placement',
    (operation, initial, edited) => {
      const original = compound(operation);
      expect(compoundArea(original)).toBe(initial);
      const source = original.booleanCompound!;
      const next = {
        ...source,
        operands: source.operands.map((operand, index) =>
          index === 1
            ? {
                ...operand,
                object: { ...operand.object, transform: { ...operand.object.transform, x: 8 } },
              }
            : operand,
        ),
      };
      const result = evaluateBooleanCompound(
        { ...original, transform: { ...original.transform, x: 100, rotationDeg: 30 } },
        next,
      );
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(compoundArea(result.value)).toBe(edited);
      expect(result.value.id).toBe(original.id);
      expect(result.value.transform).toMatchObject({ x: 100, rotationDeg: 30 });
      expect(result.value.operationIds).toEqual(original.operationIds);
      expect(original.booleanCompound?.operands[1]?.object.transform.x).toBe(5);
    },
  );
  it('retains text outline nonzero fill semantics without a live template or guide dependency', () => {
    const base = compoundRectangle('text');
    const line = base.paths[0]!.polylines[0]!;
    const text: TextObject = {
      kind: 'text',
      id: 'text',
      content: 'overlap',
      fontKey: 'test',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#000000',
      transform: base.transform,
      bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
      variableTemplate: { tokens: [{ kind: 'csv', column: 'name' }] },
      pathText: { guideObjectId: 'guide', offsetMm: 0, reverse: false },
      paths: [
        {
          color: '#000000',
          polylines: [
            line,
            { ...line, points: line.points.map((point) => ({ x: point.x + 5, y: point.y })) },
          ],
        },
      ],
    };
    const captured = captureBooleanCompound('subtract', [text, compoundRectangle('clip', 12)]);
    expect(captured.kind).toBe('ok');
    if (captured.kind !== 'ok') return;
    expect(captured.value.operands[0]?.object).not.toHaveProperty('variableTemplate');
    expect(captured.value.operands[0]?.object).not.toHaveProperty('pathText');
    expect(captured.value.operands[0]?.object.paths[0]?.fillRule).toBe('nonzero');
    const result = evaluateBooleanCompound({
      ...compoundRectangle('result'),
      booleanCompound: captured.value,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(compoundArea(result.value)).toBe(120);
  });
  it('ignores a forged derived geometry cache', () => {
    const original = compound('subtract');
    const forged = {
      ...original,
      paths: compoundRectangle('stale').paths,
      bounds: { minX: -100, minY: -100, maxX: 500, maxY: 500 },
    };
    const result = evaluateBooleanCompound(forged);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(compoundArea(result.value)).toBe(50);
    expect(result.value.bounds).toEqual({ minX: 0, minY: 0, maxX: 5, maxY: 10 });
  });
  it('keeps Weld partitions distinct even when source contours overlap', () => {
    const captured = captureBooleanCompound('weld', [
      compoundRectangle('a', 0, 'a'),
      compoundRectangle('b', 5, 'b'),
    ]);
    expect(captured.kind).toBe('ok');
    if (captured.kind !== 'ok') return;
    const result = evaluateBooleanCompound({
      ...compoundRectangle('result'),
      booleanCompound: captured.value,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.paths.map((path) => path.operationIds)).toEqual([['a'], ['b']]);
    expect(result.value.paths).toHaveLength(2);
  });
  it('refuses empty edits and cross-family ownership changes', () => {
    const original = compound('intersect');
    const retained = original.booleanCompound!;
    const moved = {
      ...retained,
      operands: retained.operands.map((operand, i) =>
        i === 1
          ? {
              ...operand,
              object: { ...operand.object, transform: { ...operand.object.transform, x: 20 } },
            }
          : operand,
      ),
    };
    expect(evaluateBooleanCompound(original, moved).kind).toBe('error');
    expect(evaluateBooleanCompound(original, { ...retained, operation: 'weld' }).kind).toBe(
      'error',
    );
  });
  it.each([
    ['operation', ['subtract']],
    ['operation', { toString: (): string => 'subtract' }],
    ['sourceKind', ['imported-svg']],
    ['sourceKind', { toString: (): string => 'imported-svg' }],
  ] as const)('rejects coercible %s metadata before reevaluating geometry', (field, value) => {
    const original = compound('subtract');
    const retained = original.booleanCompound!;
    const malformed =
      field === 'operation'
        ? { ...retained, operation: value }
        : {
            ...retained,
            operands: retained.operands.map((operand, index) =>
              index === 0 ? { ...operand, sourceKind: value } : operand,
            ),
          };
    expect(validateBooleanCompound(malformed, 'compound', () => null)).toContain(`.${field}`);
    expect(
      evaluateBooleanCompound(original, malformed as unknown as typeof retained),
    ).toMatchObject({
      kind: 'error',
      error: { kind: 'operation-failed', message: expect.stringContaining(`.${field}`) },
    });
    expect(compoundArea(original)).toBe(50);
    expect(original.booleanCompound).toBe(retained);
  });
  it('validates unique internal identity, permits repeated provenance and rejects recursion', () => {
    const retained = compound('subtract').booleanCompound!;
    const validate = (): null => null;
    expect(validateBooleanCompound(retained, 'compound', validate)).toBeNull();
    const sameSource = {
      ...retained,
      operands: retained.operands.map((operand) => ({ ...operand, sourceId: 'same' })),
    };
    expect(validateBooleanCompound(sameSource, 'compound', validate)).toBeNull();
    const sameId = {
      ...retained,
      operands: retained.operands.map((operand) => ({
        ...operand,
        object: { ...operand.object, id: 'same' },
      })),
    };
    expect(validateBooleanCompound(sameId, 'compound', validate)).toContain('unique');
    expect(evaluateBooleanCompound(compound('subtract'), sameId).kind).toBe('error');
    const recursive = {
      ...retained,
      operands: retained.operands.map((operand) => ({
        ...operand,
        object: { ...operand.object, booleanCompound: retained },
      })),
    };
    expect(validateBooleanCompound(recursive, 'compound', validate)).toContain('non-recursive');
    expect(evaluateBooleanCompound(compound('subtract'), recursive).kind).toBe('error');
    expect(
      validateBooleanCompound(
        { ...retained, operands: retained.operands.slice(0, 1) },
        'compound',
        validate,
      ),
    ).toContain('2 to');
  });
});
