import { expect, it } from 'vitest';
import { defaultConstrainedSketch } from './default-constrained-sketch';
import { resolveSketchParameters } from './sketch-parameters';
import { parseConstrainedSketch } from './sketch-validation';

it('lets a schema-valid hyphenated dimension name be referenced explicitly in an expression', () => {
  const parameters = [
    { name: 'stock-width', unit: 'mm' as const, value: 80 },
    { name: 'offset', unit: 'mm' as const, value: '[stock-width]/4 + 2mm' },
  ];
  expect(parseConstrainedSketch({ ...defaultConstrainedSketch(), parameters }).kind).toBe('ok');
  const result = resolveSketchParameters(parameters);
  expect(result.kind).toBe('ok');
  if (result.kind === 'ok') expect(result.values.get('offset')?.value).toBe(22);
});

it('preserves subtraction even when the same hyphenated name and prefixes exist', () => {
  const result = resolveSketchParameters([
    { name: 'a', unit: 'mm', value: 12 },
    { name: 'b', unit: 'mm', value: 2 },
    { name: 'a-b', unit: 'mm', value: 30 },
    { name: 'a-b-c', unit: 'mm', value: 50 },
    { name: 'difference', unit: 'mm', value: 'a-b' },
    { name: 'named', unit: 'mm', value: '[a-b]' },
    { name: 'prefixed', unit: 'mm', value: '[a-b-c]-[a-b]' },
  ]);
  if (result.kind !== 'ok') throw new Error(result.reason);
  expect(result.values.get('difference')?.value).toBe(10);
  expect(result.values.get('named')?.value).toBe(30);
  expect(result.values.get('prefixed')?.value).toBe(20);
});

it('keeps explicit parameter references distinct from unit suffixes and rejects unknown names', () => {
  const parameters = [
    { name: 'mm', unit: 'mm' as const, value: 3 },
    { name: 'deg', unit: 'deg' as const, value: 5 },
  ];
  const result = resolveSketchParameters([
    ...parameters,
    { name: 'length', unit: 'mm', value: '2mm+[mm]' },
    { name: 'angle', unit: 'deg', value: '10deg-[deg]' },
  ]);
  if (result.kind !== 'ok') throw new Error(result.reason);
  expect(result.values.get('length')?.value).toBe(5);
  expect(result.values.get('angle')?.value).toBe(5);
  expect(
    resolveSketchParameters([...parameters, { name: 'bad', unit: 'mm', value: '[missing-name]' }])
      .kind,
  ).toBe('error');
});
