import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createRegistrationLayer,
  type Layer,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { createRegistrationBox } from '../../core/shapes';
import { loneSelectableArtworkId } from './lone-selectable-artwork';
import { svgObj } from './test-helpers';

const RED = '#ff0000';

function scene(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Scene {
  return { objects, layers };
}

describe('loneSelectableArtworkId (ADR-222)', () => {
  it('returns the id when the scene has exactly one visible, unlocked artwork', () => {
    const s = scene([svgObj('A', [RED])], [createLayer({ id: RED, color: RED })]);
    expect(loneSelectableArtworkId(s)).toBe('A');
  });

  it('returns null for an empty scene', () => {
    expect(loneSelectableArtworkId(scene([], []))).toBeNull();
  });

  it('returns null when the scene has two artworks', () => {
    const s = scene(
      [svgObj('A', [RED]), svgObj('B', [RED])],
      [createLayer({ id: RED, color: RED })],
    );
    expect(loneSelectableArtworkId(s)).toBeNull();
  });

  it('does not count the registration jig as artwork', () => {
    const s = scene(
      [createRegistrationBox({ widthMm: 100, heightMm: 50 }), svgObj('A', [RED])],
      [createRegistrationLayer(), createLayer({ id: RED, color: RED })],
    );
    expect(loneSelectableArtworkId(s)).toBe('A');
  });

  it('never nominates a registration jig that is alone in the scene', () => {
    const s = scene(
      [createRegistrationBox({ widthMm: 100, heightMm: 50 })],
      [createRegistrationLayer()],
    );
    expect(loneSelectableArtworkId(s)).toBeNull();
  });

  it('returns null when the lone artwork is locked', () => {
    const s = scene(
      [{ ...svgObj('A', [RED]), locked: true }],
      [createLayer({ id: RED, color: RED })],
    );
    expect(loneSelectableArtworkId(s)).toBeNull();
  });

  it('returns null when the lone artwork sits on a hidden layer', () => {
    const s = scene(
      [svgObj('A', [RED])],
      [{ ...createLayer({ id: RED, color: RED }), visible: false }],
    );
    expect(loneSelectableArtworkId(s)).toBeNull();
  });
});
