import { describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { visibleSnapTargetPredicate } from './snap-target-visibility';

describe('visibleSnapTargetPredicate', () => {
  it('uses operation ids, legacy color aliases, and fail-visible unknown bindings canonically', () => {
    const isVisible = visibleSnapTargetPredicate([
      { ...createLayer({ id: 'hidden', color: '#111111' }), visible: false },
      { ...createLayer({ id: 'visible', color: '#222222' }), visible: true },
    ]);

    expect(isVisible(object(['hidden']))).toBe(false);
    expect(isVisible(object(['hidden', 'visible']))).toBe(true);
    expect(isVisible(object(['unknown']))).toBe(true);
    expect(isVisible({ ...object(), paths: [{ color: '#111111', polylines: [] }] })).toBe(false);
  });

  it('keeps the first layer for duplicate legacy color aliases', () => {
    const isVisible = visibleSnapTargetPredicate([
      { ...createLayer({ id: 'first', color: '#111111' }), visible: false },
      { ...createLayer({ id: 'second', color: '#111111' }), visible: true },
    ]);

    expect(isVisible({ ...object(), paths: [{ color: '#111111', polylines: [] }] })).toBe(false);
  });
});

function object(operationIds?: ReadonlyArray<string>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'target',
    source: 'target.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    ...(operationIds === undefined ? {} : { operationIds }),
  };
}
