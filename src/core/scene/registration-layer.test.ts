import { describe, expect, it } from 'vitest';
import { createRectangle, createRegistrationBox } from '../shapes';
import { createLayer, type Layer } from './layer';
import {
  REGISTRATION_LAYER_COLOR,
  REGISTRATION_LAYER_ID,
  createRegistrationLayer,
  findRegistrationBoxBounds,
  findRegistrationBoxes,
  findRegistrationLayer,
  isRegistrationBox,
  isRegistrationLayer,
  registrationOutputConflict,
  registrationRunState,
} from './registration-layer';
import { EMPTY_SCENE, type Scene } from './scene';
import type { SceneObject } from './scene-object';

function makeScene(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Scene {
  return { ...EMPTY_SCENE, objects, layers };
}

describe('registration layer', () => {
  it('createRegistrationLayer uses the reserved id, color, and line mode', () => {
    const layer = createRegistrationLayer();
    expect(layer.id).toBe(REGISTRATION_LAYER_ID);
    expect(layer.color).toBe(REGISTRATION_LAYER_COLOR);
    expect(layer.mode).toBe('line');
    expect(layer.output).toBe(true);
    expect(layer.visible).toBe(true);
  });

  it('isRegistrationLayer distinguishes the reserved layer from color layers', () => {
    expect(isRegistrationLayer(createRegistrationLayer())).toBe(true);
    expect(isRegistrationLayer(createLayer({ id: '#000000', color: '#000000' }))).toBe(false);
  });

  it('findRegistrationLayer returns the layer when present and null otherwise', () => {
    const layer = createRegistrationLayer();
    expect(findRegistrationLayer(makeScene([], [layer]))).toBe(layer);
    expect(findRegistrationLayer(makeScene([], []))).toBeNull();
  });

  it('findRegistrationBoxes returns shapes on the registration layer matched by color', () => {
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40, x: 10, y: 20 });
    const otherColor = createRectangle({
      id: 'other',
      color: '#123456',
      spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
    });
    const scene = makeScene([box, otherColor], [createRegistrationLayer()]);
    const found = findRegistrationBoxes(scene);
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(box.id);
  });

  it('findRegistrationBoxes is empty when there is no registration layer', () => {
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40 });
    expect(findRegistrationBoxes(makeScene([box], []))).toHaveLength(0);
  });

  it('findRegistrationBoxBounds returns the box bounds in scene space', () => {
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40, x: 10, y: 20 });
    const scene = makeScene([box], [createRegistrationLayer()]);
    expect(findRegistrationBoxBounds(scene)).toEqual({ minX: 10, minY: 20, maxX: 90, maxY: 60 });
  });

  it('findRegistrationBoxBounds is null when no jig is present', () => {
    expect(findRegistrationBoxBounds(makeScene([], []))).toBeNull();
  });

  it('registrationRunState reports the active burn run from layer output', () => {
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40 });
    const reg = createRegistrationLayer();
    const art = createLayer({ id: '#000000', color: '#000000' });
    expect(registrationRunState(makeScene([], []))).toBe('none');
    expect(
      registrationRunState(makeScene([box], [{ ...reg, output: true }, { ...art, output: false }])),
    ).toBe('box');
    expect(
      registrationRunState(makeScene([box], [{ ...reg, output: false }, { ...art, output: true }])),
    ).toBe('artwork');
    expect(
      registrationRunState(makeScene([box], [{ ...reg, output: true }, { ...art, output: true }])),
    ).toBe('mixed');
  });

  it('registrationOutputConflict flags box + artwork both set to output', () => {
    const box = createRegistrationBox({ widthMm: 80, heightMm: 40 });
    const reg = createRegistrationLayer();
    const art = createLayer({ id: '#000000', color: '#000000' });
    expect(registrationOutputConflict(makeScene([], []))).toBe(false);
    expect(
      registrationOutputConflict(
        makeScene([box], [{ ...reg, output: true }, { ...art, output: true }]),
      ),
    ).toBe(true);
    expect(
      registrationOutputConflict(
        makeScene([box], [{ ...reg, output: true }, { ...art, output: false }]),
      ),
    ).toBe(false);
    expect(
      registrationOutputConflict(
        makeScene([box], [{ ...reg, output: false }, { ...art, output: true }]),
      ),
    ).toBe(false);
  });

  it('isRegistrationBox matches the reserved-color shape, not other colors', () => {
    expect(isRegistrationBox(createRegistrationBox({ widthMm: 80, heightMm: 40 }))).toBe(true);
    // A shape of another color is artwork, not the jig.
    expect(
      isRegistrationBox(
        createRectangle({
          id: 'art',
          color: '#123456',
          spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
        }),
      ),
    ).toBe(false);
  });
});
