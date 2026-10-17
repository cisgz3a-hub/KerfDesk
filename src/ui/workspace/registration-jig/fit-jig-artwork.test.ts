import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createRegistrationLayer,
  transformedBBox,
  type Scene,
  type ShapeObject,
} from '../../../core/scene';
import { createRegistrationBox, createRegistrationCircle } from '../../../core/shapes';
import { svgObj } from '../../state/test-helpers';
import { fitJigArtwork } from './fit-jig-artwork';

function scene(...objects: ShapeObject[]): Scene {
  return { objects, layers: [createRegistrationLayer()] };
}
const artwork = {
  ...svgObj('large-trace', ['#000000']),
  bounds: { minX: 200, minY: 100, maxX: 2200, maxY: 1100 },
};

describe('fit imported artwork to a jig', () => {
  it('fills the first outline with a margin, preserves proportions, and centres offset geometry', () => {
    const jig = createRegistrationBox({ widthMm: 80, heightMm: 40, x: 30, y: 50 });
    const fitted = fitJigArtwork(artwork, scene(jig), new Set());
    expect(transformedBBox(fitted)).toEqual({ minX: 34, minY: 52, maxX: 106, maxY: 88 });
    expect(fitted.transform.scaleX).toBe(fitted.transform.scaleY);
  });

  it('fits the selected blank rather than the combined grid', () => {
    const first = createRegistrationBox({ widthMm: 80, heightMm: 40 });
    const second = createRegistrationBox({
      widthMm: 20,
      heightMm: 20,
      x: 200,
      y: 100,
      id: 'second',
    });
    const fitted = fitJigArtwork(artwork, scene(first, second), new Set(['second']));
    expect(transformedBBox(fitted)).toEqual({ minX: 201, minY: 105.5, maxX: 219, maxY: 114.5 });
  });

  it.each(['rectangle', 'circle'])('keeps all corners inside a rotated and scaled %s', (kind) => {
    const base =
      kind === 'circle'
        ? createRegistrationCircle({ diameterMm: 40 })
        : createRegistrationBox({ widthMm: 80, heightMm: 40 });
    const jig = {
      ...base,
      transform: {
        ...base.transform,
        x: 120,
        y: 70,
        rotationDeg: 37,
        scaleX: 1.5,
        scaleY: 0.8,
        mirrorX: true,
      },
    };
    const fitted = fitJigArtwork(artwork, scene(jig), new Set());
    const center = applyTransform(
      { x: base.bounds.maxX / 2, y: base.bounds.maxY / 2 },
      jig.transform,
    );
    for (const x of [artwork.bounds.minX, artwork.bounds.maxX]) {
      for (const y of [artwork.bounds.minY, artwork.bounds.maxY]) {
        const point = applyTransform({ x, y }, fitted.transform);
        const angle = (-37 * Math.PI) / 180;
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const rx = (dx * Math.cos(angle) - dy * Math.sin(angle)) / ((base.bounds.maxX * 1.5) / 2);
        const ry = (dx * Math.sin(angle) + dy * Math.cos(angle)) / ((base.bounds.maxY * 0.8) / 2);
        expect(
          kind === 'circle' ? Math.hypot(rx, ry) : Math.max(Math.abs(rx), Math.abs(ry)),
        ).toBeLessThanOrEqual(0.900001);
      }
    }
  });

  it('leaves the normal import fallback available when there is no outline', () => {
    expect(fitJigArtwork(artwork, scene(), new Set())).toBe(artwork);
  });
});
