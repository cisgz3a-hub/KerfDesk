import { describe, expect, it } from 'vitest';
import type { ReliefSculptStroke, ReliefVectorMask } from '../scene/relief/relief-authoring';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { appendReliefStroke, createReliefAuthoringDocument } from './relief-authoring-document';
import { materializeReliefAuthoring } from './materialize-relief-authoring';
import { createComponentSampler } from './relief-authoring-sampling';
import { reliefStrokeDabs } from './relief-sculpt';

const source = () =>
  testReliefHeightfield({
    width: 5,
    height: 5,
    physicalWidthMm: 5,
    physicalHeightMm: 5,
    samplesU16: Array.from({ length: 25 }, (_, i) => (i === 12 ? 50000 : 20000)),
    maxDepthMm: 10,
  });
const stroke = (mode: ReliefSculptStroke['mode']): ReliefSculptStroke => ({
  schemaVersion: 1,
  id: 'stroke-1',
  componentId: 'source-1',
  mode,
  points: [{ x: 2.5, y: 2.5 }],
  diameterMm: 4,
  strength: mode === 'add' || mode === 'remove' ? 1 : 0.5,
  flattenHeightMm: 6,
});
function compose(mode: ReliefSculptStroke['mode'], region?: ReliefVectorMask) {
  const original = createReliefAuthoringDocument(source());
  const after = appendReliefStroke(original, {
    ...stroke(mode),
    ...(region === undefined ? {} : { region }),
  });
  const result = materializeReliefAuthoring(after);
  if (result.kind !== 'ok') throw new Error('Failed sculpt');
  return {
    original,
    after,
    result,
    sample: createComponentSampler({ kind: 'retained-field-v1', field: result.field }),
  };
}

describe('masked scalar sculpting', () => {
  it.each(['add', 'remove'] as const)(
    '%s changes only covered selected component samples',
    (mode) => {
      const { sample } = compose(mode);
      expect(sample({ x: 2.5, y: 2.5 }).heightMm).toBeCloseTo(
        (50000 / 65535) * 10 + (mode === 'add' ? 1 : -1),
        3,
      );
      expect(sample({ x: 0.5, y: 0.5 }).heightMm).toBeCloseTo((20000 / 65535) * 10, 3);
    },
  );
  it('smooth averages the pre-dab neighbourhood without directional smear', () => {
    const { sample } = compose('smooth');
    const centre = (50000 / 65535) * 10,
      neighbour = (20000 / 65535) * 10;
    expect(sample({ x: 2.5, y: 2.5 }).heightMm).toBeCloseTo(
      centre + ((centre + neighbour * 8) / 9 - centre) * 0.5,
      3,
    );
    expect(sample({ x: 1.5, y: 2.5 }).heightMm).toBe(sample({ x: 3.5, y: 2.5 }).heightMm);
  });
  it('flatten respects the chosen plane and explicit stroke region', () => {
    const region = {
      rings: [
        {
          closed: true,
          points: [
            { x: 2, y: 2 },
            { x: 3, y: 2 },
            { x: 3, y: 3 },
            { x: 2, y: 3 },
          ],
        },
      ],
    };
    const { sample } = compose('flatten', region);
    expect(sample({ x: 2.5, y: 2.5 }).heightMm).toBeCloseTo(((50000 / 65535) * 10 + 6) / 2, 3);
    expect(sample({ x: 1.5, y: 2.5 }).heightMm).toBeCloseTo((20000 / 65535) * 10, 3);
  });
  it('retained before/after documents give exact stroke undo and redo with no 8-bit requantisation', () => {
    const { original, after, result } = compose('add');
    const beforeResult = materializeReliefAuthoring(original);
    expect(beforeResult.kind).toBe('ok');
    if (beforeResult.kind !== 'ok') throw new Error('Failed original');
    expect(beforeResult.field.samplesBase64).toBe(source().samplesBase64);
    expect(materializeReliefAuthoring(after)).toEqual(result);
    expect(original.strokes).toEqual([]);
    expect(after.revision).toBe(original.revision + 1);
  });
  it('physical spacing is stable when pointer events split the same straight stroke', () => {
    const base = stroke('add');
    expect(
      reliefStrokeDabs({
        ...base,
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
        ],
      }),
    ).toEqual(
      reliefStrokeDabs({
        ...base,
        points: [
          { x: 0, y: 0 },
          { x: 1.2, y: 0 },
          { x: 4, y: 0 },
        ],
      }),
    );
  });
  it('physical diameter accounts for non-uniform artwork scale', () => {
    const original = createReliefAuthoringDocument(source());
    const edited = appendReliefStroke(original, {
      ...stroke('add'),
      metricScaleX: 4,
      metricScaleY: 1,
    });
    const result = materializeReliefAuthoring(edited);
    if (result.kind !== 'ok') throw new Error('Failed sculpt');
    const sample = createComponentSampler({ kind: 'retained-field-v1', field: result.field });
    expect(sample({ x: 1.5, y: 2.5 }).heightMm).toBeCloseTo((20000 / 65535) * 10, 3);
    expect(sample({ x: 2.5, y: 1.5 }).heightMm).toBeGreaterThan((20000 / 65535) * 10);
  });
  it('rejects work-heavy or invalid strokes with no partial publication', () => {
    const doc = createReliefAuthoringDocument(source());
    expect(
      materializeReliefAuthoring(
        appendReliefStroke(doc, {
          ...stroke('add'),
          points: [
            { x: 0, y: 0 },
            { x: 1e9, y: 0 },
          ],
        }),
      ).kind,
    ).toBe('error');
    expect(
      materializeReliefAuthoring(appendReliefStroke(doc, { ...stroke('smooth'), strength: 2 }))
        .kind,
    ).toBe('error');
    expect(doc.strokes.length).toBe(0);
  });
});
