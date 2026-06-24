import { describe, expect, it } from 'vitest';
import { createRegistrationBox } from '../shapes';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  type Scene,
  type SceneObject,
} from '../scene';
import { computeRegistrationBoxBounds } from './registration-placement';

const device = createProject().device;

function artObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 200, y: 200 },
    paths: [
      {
        color: '#00ff00',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 5, y: 5 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

function jigScene(boxOutput: boolean): Scene {
  let scene = addObject(
    createProject().scene,
    createRegistrationBox({ widthMm: 80, heightMm: 40, x: 10, y: 20 }),
  );
  scene = addObject(scene, artObject());
  scene = addLayer(scene, { ...createRegistrationLayer(), output: boxOutput });
  scene = addLayer(scene, createLayer({ id: '#00ff00', color: '#00ff00' }));
  return scene;
}

describe('computeRegistrationBoxBounds', () => {
  it('returns null when there is no registration jig', () => {
    expect(computeRegistrationBoxBounds(createProject().scene, device)).toBeNull();
  });

  it('measures the box even when the registration layer output is off (art run)', () => {
    const onRun = computeRegistrationBoxBounds(jigScene(true), device);
    const offRun = computeRegistrationBoxBounds(jigScene(false), device);
    expect(offRun).not.toBeNull();
    expect(offRun).toEqual(onRun);
  });

  it('measures only the box, excluding faraway artwork', () => {
    const bounds = computeRegistrationBoxBounds(jigScene(true), device);
    expect(bounds).not.toBeNull();
    if (bounds === null) return;
    // The origin transform may flip Y, but a sharp rectangle's extent is
    // preserved: the box is 80x40, and the 5 mm art line at (200,200) is excluded.
    expect(bounds.maxX - bounds.minX).toBeCloseTo(80, 6);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(40, 6);
  });
});
