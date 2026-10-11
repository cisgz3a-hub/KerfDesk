import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { createExtendModel, findExtendTarget } from './extend-shapes';

const p = (x: number, y: number) => ({ x, y });
const curve: CurveSubpath = {
  start: p(100, 20),
  closed: false,
  segments: [{ kind: 'cubic', control1: p(110, 20), control2: p(120, 20), to: p(130, 20) }],
};

function artwork(id: string, canonical?: CurveSubpath): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        polylines: [{ closed: false, points: [p(0, 0), p(1, 0)] }],
        ...(canonical === undefined ? {} : { curves: [canonical] }),
      },
    ],
  };
}

function scene(...objects: ImportedSvg[]): Scene {
  return { objects, groups: [], layers: [createLayer({ id: 'cut', color: '#000000' })] };
}

describe('Extend canonical endpoint bounds', () => {
  it('picks both canonical endpoints outside stale object and compatibility bounds', () => {
    const source = artwork('source', curve);
    const left = artwork('left', {
      start: p(90, 10),
      closed: false,
      segments: [{ kind: 'line', to: p(90, 30) }],
    });
    const right = artwork('right', {
      start: p(140, 10),
      closed: false,
      segments: [{ kind: 'line', to: p(140, 30) }],
    });
    const model = createExtendModel(scene(source, left, right));
    expect(findExtendTarget(model, curve.start, 0.1)).toMatchObject({
      status: 'ready',
      end: 'start',
      from: curve.start,
      to: p(90, 20),
    });
    expect(findExtendTarget(model, p(130, 20), 0.1)).toMatchObject({
      status: 'ready',
      end: 'end',
      to: p(140, 20),
    });
    expect(findExtendTarget(model, p(1, 0), 0.1)).toBeNull();
  });

  it('transforms canonical bounds through scale, reflection and rotation', () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      scaleX: 2,
      scaleY: 3,
      rotationDeg: 37,
      mirrorX: true,
      x: 12,
      y: -8,
    };
    const source = { ...artwork('source', curve), transform };
    const target = {
      ...artwork('target', {
        start: p(140, 10),
        closed: false,
        segments: [{ kind: 'line', to: p(140, 30) }],
      }),
      transform,
    };
    const found = findExtendTarget(
      scene(source, target),
      applyTransform(p(130, 20), transform),
      0.1,
    );
    expect(found?.status).toBe('ready');
    expect(found?.to?.x).toBeCloseTo(applyTransform(p(140, 20), transform).x, 9);
    expect(found?.to?.y).toBeCloseTo(applyTransform(p(140, 20), transform).y, 9);
    expect(found?.distanceMm).toBeCloseTo(20, 9);
  });
});
