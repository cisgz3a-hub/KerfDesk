import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { IDENTITY_TRANSFORM, type SceneObject } from '../scene/scene-object';
import type {
  ReliefAuthoringDocument,
  ReliefCombineMode,
  ReliefComponent,
  ReliefVectorMask,
} from '../scene/relief/relief-authoring';
import {
  createBlankReliefAuthoringDocument,
  createReliefAuthoringDocument,
  bakeReliefComponent,
  reviseReliefDocument,
} from './relief-authoring-document';
import { materializeReliefAuthoring } from './materialize-relief-authoring';
import { createComponentSampler } from './relief-authoring-sampling';
import { reliefAuthoringError } from './relief-authoring-validation';
import { refreshReliefVectorLinks } from './relief-authoring-links';

const rectangle = (x = 0, y = 0, width = 6, height = 6): ReliefVectorMask => ({
  rings: [
    {
      closed: true,
      points: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
    },
  ],
});
const shape = (
  profile: 'plane' | 'dome' | 'slope' = 'plane',
  heightMm = 2,
  combineMode: ReliefCombineMode = 'replace',
): ReliefComponent => ({
  id: 'C1',
  name: 'Analytic',
  levelId: 'level-1',
  visible: true,
  combineMode,
  transform: IDENTITY_TRANSFORM,
  baseHeightMm: 0,
  heightScale: 1,
  source: { kind: 'vector-shape-v1', boundary: rectangle(), profile, heightMm, angleDeg: 0 },
});
const document = (components: readonly ReliefComponent[] = [shape()]): ReliefAuthoringDocument => ({
  ...createBlankReliefAuthoringDocument({
    width: 3,
    height: 3,
    physicalWidthMm: 6,
    physicalHeightMm: 6,
    maxDepthMm: 10,
  }),
  components,
});
function field(doc: ReliefAuthoringDocument) {
  const result = materializeReliefAuthoring(doc);
  if (result.kind !== 'ok') throw new Error(result.kind === 'error' ? result.reason : 'Cancelled');
  return result;
}
function at(doc: ReliefAuthoringDocument, x: number, y: number) {
  return createComponentSampler({ kind: 'retained-field-v1', field: field(doc).field })({ x, y });
}

describe('retained relief composition', () => {
  it.each<[ReliefCombineMode, number]>([
    ['add', 6],
    ['subtract', 2],
    ['max', 4],
    ['min', 2],
    ['replace', 2],
  ])('uses an explicit floor datum for %s', (mode, expected) => {
    expect(
      at({ ...document([shape('plane', 2, mode)]), baselineHeightMm: 4 }, 3, 3).heightMm,
    ).toBeCloseTo(expected, 3);
  });
  it('orders levels first, then components, independent of component array grouping', () => {
    const c1 = shape(),
      c2 = { ...shape('plane', 7), id: 'C2', levelId: 'level-2' };
    const doc = {
      ...document([c1, c2]),
      levels: [
        { id: 'level-2', name: 'First', visible: true },
        { id: 'level-1', name: 'Last', visible: true },
      ],
    };
    expect(at(doc, 3, 3).heightMm).toBeCloseTo(2, 3);
    expect(
      at({ ...doc, levels: doc.levels.map((l) => ({ ...l, visible: l.id === 'level-2' })) }, 3, 3)
        .heightMm,
    ).toBeCloseTo(7, 3);
  });
  it('preserves original 16-bit codes, masks and nontrivial mapping without remapping', () => {
    const source = testReliefHeightfield({
      width: 3,
      height: 1,
      physicalWidthMm: 6,
      physicalHeightMm: 2,
      samplesU16: [101, 32769, 65534],
      maxDepthMm: 10,
      inclusionMask: [1, 128, 255],
      mapping: {
        polarity: 'light-is-deep',
        inputLowCode: 60000,
        inputHighCode: 100,
        curve: { kind: 'gamma-v1', gamma: 1.7 },
        inclusionThreshold: 128,
        outsideMask: 'relief-floor',
      },
    });
    const result = field(createReliefAuthoringDocument(source));
    expect(result.field).toEqual(source);
    expect(result.quantizationToleranceMm).toBe(0);
  });
  it('reports range clipping and never emits values above top or below floor', () => {
    const result = field(document([shape('plane', 20)]));
    expect(result.warnings[0]).toMatch(/9 included samples/);
    expect(
      createComponentSampler({ kind: 'retained-field-v1', field: result.field })({ x: 3, y: 3 })
        .heightMm,
    ).toBe(10);
  });
  it('cancelled composition has no result field and does not mutate retained source', () => {
    const doc = document();
    const before = JSON.stringify(doc);
    let probes = 0;
    expect(materializeReliefAuthoring(doc, { cancelled: () => ++probes > 3 }).kind).toBe(
      'cancelled',
    );
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('admits bounded resources before allocating cells', () => {
    expect(reliefAuthoringError({ ...document(), width: 2000, height: 2000 })).toMatch(/1,048,576/);
    expect(reliefAuthoringError({ ...document(), components: [shape(), shape()] })).toMatch(
      /duplicate/,
    );
  });
});

describe('closed vector relief generators and masks', () => {
  it('declares and meets the independent half-U16-step error bound', () => {
    for (const height of [0.00123, 0.123456789, 1.111111, 2.618033988, 5.12345, 7.777777, 9.9999]) {
      const result = field(document([shape('plane', height)]));
      const actual = createComponentSampler({ kind: 'retained-field-v1', field: result.field })({
        x: 3,
        y: 3,
      }).heightMm;
      expect(result.quantizationToleranceMm).toBe(10 / 65535 / 2);
      expect(Math.abs(actual - height)).toBeLessThanOrEqual(10 / 65535 / 2 + 1e-12);
    }
  });
  it('materialises the maximum admitted million-cell field without changing declared resolution', () => {
    const doc = { ...document([shape('plane', 2.618033988)]), width: 1024, height: 1024 };
    const result = field(doc);
    expect(result.field.width).toBe(1024);
    expect(result.field.height).toBe(1024);
    expect(result.warnings).toEqual([]);
    expect(result.field.revision).toBe(doc.revision);
  });
  it('matches the analytical elliptical cap at centre and symmetric offsets', () => {
    const doc = document([shape('dome', 4)]);
    expect(at(doc, 3, 3).heightMm).toBeCloseTo(4, 3);
    const expected = 4 * Math.sqrt(1 - 4 / 9);
    expect(at(doc, 1, 3).heightMm).toBeCloseTo(expected, 3);
    expect(at(doc, 5, 3).heightMm).toBeCloseTo(expected, 3);
  });
  it('maps an angled slope from min to max boundary projection in local mm', () => {
    const source = shape('slope', 6).source;
    if (source.kind !== 'vector-shape-v1') throw new Error('Bad fixture');
    const doc = document([{ ...shape(), source: { ...source, angleDeg: 90 } }]);
    expect(at(doc, 1, 1).heightMm).toBeCloseTo(1, 3);
    expect(at(doc, 1, 5).heightMm).toBeCloseTo(5, 3);
  });
  it('keeps concave empty regions and even-odd holes excluded', () => {
    const c = shape();
    if (c.source.kind !== 'vector-shape-v1') throw new Error('Bad fixture');
    const hole = { rings: [...rectangle().rings, ...rectangle(2, 2, 2, 2).rings] };
    const doc = {
      ...document([{ ...c, source: { ...c.source, boundary: hole } }]),
      outsideMask: 'excluded' as const,
    };
    expect(at(doc, 3, 3).included).toBe(false);
    expect(at(doc, 1, 3).heightMm).toBeCloseTo(2, 3);
    const concave = {
      rings: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 6, y: 2 },
            { x: 2, y: 2 },
            { x: 2, y: 6 },
            { x: 0, y: 6 },
          ],
        },
      ],
    };
    const lDoc = { ...doc, components: [{ ...c, source: { ...c.source, boundary: concave } }] };
    expect(at(lDoc, 5, 5).included).toBe(false);
    expect(at(lDoc, 1, 5).included).toBe(true);
  });
  it('uses physical component transforms and exact base/scale', () => {
    const c = {
      ...shape(),
      transform: { ...IDENTITY_TRANSFORM, x: 2, scaleX: 0.5, scaleY: 0.5 },
      baseHeightMm: 0.123456789,
      heightScale: 1.5,
    };
    const doc = { ...document([c]), outsideMask: 'excluded' as const };
    expect(at(doc, 3, 1).heightMm).toBeCloseTo(3.123456789, 3);
    expect(at(doc, 1, 1).included).toBe(false);
    expect(JSON.parse(JSON.stringify(doc)).components[0].baseHeightMm).toBe(0.123456789);
  });
  it('rejects crossing/open boundaries instead of pretending they are representable', () => {
    const c = shape();
    if (c.source.kind !== 'vector-shape-v1') throw new Error('Bad fixture');
    const boundary = {
      rings: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 6, y: 6 },
            { x: 0, y: 6 },
            { x: 6, y: 0 },
          ],
        },
      ],
    };
    expect(
      materializeReliefAuthoring(document([{ ...c, source: { ...c.source, boundary } }])).kind,
    ).toBe('error');
    expect(
      materializeReliefAuthoring(
        document([
          {
            ...c,
            source: {
              ...c.source,
              boundary: { rings: [{ ...rectangle().rings[0]!, closed: false }] },
            },
          },
        ]),
      ).kind,
    ).toBe('error');
  });
  it('linked geometry edits update revision once and a baked source stays detached', () => {
    const vector: SceneObject = {
      kind: 'shape',
      id: 'V1',
      spec: { kind: 'rect', widthMm: 6, heightMm: 6, cornerRadiusMm: 0 },
      color: '#000000',
      bounds: { minX: 0, minY: 0, maxX: 6, maxY: 6 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#000000', polylines: rectangle().rings }],
    };
    const doc = {
      ...document(),
      clip: { ...rectangle(), linkedObjectId: 'V1' },
      outsideMask: 'excluded' as const,
    };
    const first = refreshReliefVectorLinks(doc, [vector], IDENTITY_TRANSFORM);
    expect(first.kind === 'ok' && first.changed).toBe(false);
    const changed = refreshReliefVectorLinks(
      doc,
      [{ ...vector, transform: { ...IDENTITY_TRANSFORM, x: 2 } }],
      IDENTITY_TRANSFORM,
    );
    if (changed.kind !== 'ok') throw new Error(changed.reason);
    expect(changed.document.revision).toBe(doc.revision + 1);
    expect(at(changed.document, 1, 3).included).toBe(false);
    const baked = bakeReliefComponent(field(changed.document).field, 'B1', 'level-1');
    const detached = reviseReliefDocument(document([baked]), {});
    expect(refreshReliefVectorLinks(detached, [], IDENTITY_TRANSFORM).kind).toBe('ok');
    expect(refreshReliefVectorLinks(doc, [], IDENTITY_TRANSFORM).kind).toBe('error');
  });
});
