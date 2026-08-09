import { describe, expect, it } from 'vitest';
import { viewer3DCameraControlForKey, viewer3DZoomScale } from './viewer3d-keyboard-controls';

describe('viewer3D keyboard controls', () => {
  it('uses arrows to pan and Shift+arrows to orbit', () => {
    expect(controlFor('ArrowLeft')).toEqual({ kind: 'pan', deltaX: 12, deltaY: 0 });
    expect(controlFor('ArrowUp', { shiftKey: true })).toEqual({
      kind: 'rotate',
      deltaX: 0,
      deltaY: 12,
    });
  });

  it('maps plus and minus onto opposing zoom directions', () => {
    expect(controlFor('+')).toEqual({ kind: 'zoom', deltaY: -100 });
    expect(controlFor('-')).toEqual({ kind: 'zoom', deltaY: 100 });
    expect(viewer3DZoomScale(-100)).toBeLessThan(1);
    expect(viewer3DZoomScale(100)).toBeGreaterThan(1);
  });

  it('leaves unrelated keys available to the dialog and application', () => {
    expect(controlFor('Escape')).toBeNull();
    expect(controlFor('Tab')).toBeNull();
  });

  it('leaves host modifier chords available to the browser and application', () => {
    expect(controlFor('+', { ctrlKey: true })).toBeNull();
    expect(controlFor('-', { metaKey: true })).toBeNull();
    expect(controlFor('ArrowLeft', { altKey: true })).toBeNull();
  });
});

function controlFor(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {},
) {
  const event = {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
  return viewer3DCameraControlForKey(event);
}
