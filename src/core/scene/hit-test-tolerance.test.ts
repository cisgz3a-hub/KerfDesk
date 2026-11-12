// The reach of a click on a line is the caller's (a screen distance in the
// workspace), and the nearest line in reach wins (ADR-196 Amendment 1).

import { describe, expect, it } from 'vitest';
import { createEllipse } from '../shapes/primitives';
import { createLayer } from './layer';
import type { Scene } from './scene';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';
import { DEFAULT_STROKE_HIT_TOLERANCE_MM, hitTest, hitTestDetailed } from './hit-test';
import { hitTestCandidates } from './hit-test-candidates';

const LINE_COLOR = '#ff0000';
const FILL_COLOR = '#0000ff';

function line(id: string, y: number, color = LINE_COLOR): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    transform: { ...IDENTITY_TRANSFORM, y },
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

function box(id: string, min: number, max: number, color = LINE_COLOR): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: min, minY: min, maxX: max, maxY: max },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: min, y: min },
              { x: max, y: min },
              { x: max, y: max },
              { x: min, y: max },
            ],
          },
        ],
      },
    ],
  };
}

function scene(...objects: SceneObject[]): Scene {
  return {
    objects,
    layers: [
      createLayer({ id: LINE_COLOR, color: LINE_COLOR }),
      createLayer({ id: FILL_COLOR, color: FILL_COLOR, mode: 'fill' }),
    ],
    groups: [],
  };
}

describe('the reach of a click on a line', () => {
  const one = scene(line('a', 50));

  it('stays 2 mm for a caller with no view', () => {
    expect(DEFAULT_STROKE_HIT_TOLERANCE_MM).toBe(2);
    expect(hitTest(one, { x: 40, y: 51.9 })).toBe('a');
    expect(hitTest(one, { x: 40, y: 52.1 })).toBeNull();
  });

  it.each([0.05, 0.5, 2, 8])('is the %f mm the caller asks for', (strokeToleranceMm) => {
    const options = { strokeToleranceMm };
    expect(hitTest(one, { x: 40, y: 50 + strokeToleranceMm * 0.9 }, options)).toBe('a');
    expect(hitTest(one, { x: 40, y: 50 + strokeToleranceMm * 1.1 }, options)).toBeNull();
    // Past the end of the line it is a distance too, not a box.
    expect(hitTest(one, { x: 100 + strokeToleranceMm * 0.9, y: 50 }, options)).toBe('a');
    expect(hitTest(one, { x: 100 + strokeToleranceMm * 1.1, y: 50 }, options)).toBeNull();
  });

  it('gives Alt+click the same reach', () => {
    const options = { strokeToleranceMm: 0.5 };
    expect(hitTestCandidates(one, { x: 40, y: 50.4 }, options)).toEqual(['a']);
    expect(hitTestCandidates(one, { x: 40, y: 50.6 }, options)).toEqual([]);
  });

  it('follows a curve as closely as the reach asks, whatever the scale', () => {
    // A 10 mm circle drawn 4 times its size. Chords cut for the 2 mm reach lie
    // up to 1 mm inside it here: twenty times this reach. (Its four cubic
    // arcs are themselves within 0.006 mm of a true circle at this size.)
    const circle = createEllipse({
      id: 'circle',
      color: LINE_COLOR,
      spec: { widthMm: 10, heightMm: 10 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: 4, scaleY: 4 },
    });
    const curved = scene(circle);
    const options = { strokeToleranceMm: 0.05 };
    for (let step = 0; step < 720; step += 1) {
      const angle = (step / 720) * 2 * Math.PI;
      const at = (radius: number) => ({
        x: 20 + radius * Math.cos(angle),
        y: 20 + radius * Math.sin(angle),
      });
      expect(hitTest(curved, at(20), options), `on the curve at step ${step}`).toBe('circle');
      expect(hitTestDetailed(curved, at(20.1), options), `outside at step ${step}`).toBeNull();
      // Inside it, a click that is not on the line picks the circle by its interior.
      expect(hitTestDetailed(curved, at(19.9), options)?.kind, `inside at step ${step}`).toBe(
        'interior',
      );
    }
  });
});

describe('several lines in reach', () => {
  it('picks the nearest, not the one stacked on top', () => {
    const lines = scene(line('under', 50), line('over', 51));
    expect(hitTest(lines, { x: 40, y: 50.2 })).toBe('under');
    expect(hitTest(lines, { x: 40, y: 50.8 })).toBe('over');
  });

  it('falls back to stacking order when they are equally near', () => {
    const lines = scene(line('under', 50), line('over', 50));
    expect(hitTest(lines, { x: 40, y: 50.3 })).toBe('over');
    const apart = scene(line('under', 50), line('over', 51));
    expect(hitTest(apart, { x: 40, y: 50.5 })).toBe('over');
  });

  it('keeps Alt+click cycling in stacking order', () => {
    const lines = scene(line('under', 50), line('over', 51));
    expect(hitTestCandidates(lines, { x: 40, y: 50.2 })).toEqual(['over', 'under']);
  });

  it('lets a line drawn over a filled shape win beside the line', () => {
    const scene1 = scene(box('fill', 0, 100, FILL_COLOR), line('line', 50));
    expect(hitTest(scene1, { x: 40, y: 51 })).toBe('line');
    expect(hitTest(scene1, { x: 40, y: 60 })).toBe('fill');
  });

  it('does not reach through a filled shape to a line beneath it', () => {
    const scene1 = scene(line('line', 50), box('fill', 0, 100, FILL_COLOR));
    expect(hitTest(scene1, { x: 40, y: 51 })).toBe('fill');
  });

  it('picks the nearer line among those above the filled shape under the pointer', () => {
    const scene1 = scene(
      line('buried', 50.1),
      box('fill', 0, 100, FILL_COLOR),
      line('near', 50.4),
      line('far', 51.5),
    );
    expect(hitTest(scene1, { x: 40, y: 50 })).toBe('near');
  });
});

describe('what kind of hit a click made', () => {
  const nested = scene(box('frame', 0, 100), box('inner', 40, 60));

  it('tells a line from the inside of an outline', () => {
    expect(hitTestDetailed(nested, { x: 50, y: 0.5 })).toEqual({ id: 'frame', kind: 'direct' });
    expect(hitTestDetailed(nested, { x: 20, y: 20 })).toEqual({ id: 'frame', kind: 'interior' });
    expect(hitTestDetailed(nested, { x: 50, y: 50 })).toEqual({ id: 'inner', kind: 'interior' });
    expect(hitTestDetailed(nested, { x: 150, y: 150 })).toBeNull();
  });

  it('calls a filled shape a direct hit anywhere inside it', () => {
    const filled = scene(box('fill', 0, 100, FILL_COLOR));
    expect(hitTestDetailed(filled, { x: 50, y: 50 })).toEqual({ id: 'fill', kind: 'direct' });
  });
});
