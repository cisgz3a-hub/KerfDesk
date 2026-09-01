import { describe, expect, it } from 'vitest';
import { resolveVisibleOperationForPath, sceneLayerVisibilityLookup } from './visibility';

describe('sceneLayerVisibilityLookup', () => {
  it('keeps exact ids and the first operation for each legacy color alias', () => {
    const first = { id: 'first', color: '#111111', visible: false };
    const second = { id: 'second', color: '#111111', visible: true };
    const lookup = sceneLayerVisibilityLookup([first, second]);

    expect(lookup.get(first.id)).toBe(first);
    expect(lookup.get(second.id)).toBe(second);
    expect(lookup.get(first.color)).toBe(first);
  });
});

describe('resolveVisibleOperationForPath', () => {
  const path = { color: '#111111', operationIds: ['first', 'second'] };

  it('selects the first visible bound operation deterministically', () => {
    const first = { visible: false, style: 'first' };
    const second = { visible: true, style: 'second' };
    const resolved = resolveVisibleOperationForPath(
      {},
      path,
      new Map([
        ['first', first],
        ['second', second],
      ]),
    );

    expect(resolved).toEqual({ visible: true, operation: second });
  });

  it('hides only when every known binding is hidden', () => {
    expect(
      resolveVisibleOperationForPath(
        {},
        path,
        new Map([
          ['first', { visible: false }],
          ['second', { visible: false }],
        ]),
      ),
    ).toEqual({ visible: false, operation: undefined });
  });

  it('keeps orphaned bindings fail-visible without inventing styling', () => {
    expect(resolveVisibleOperationForPath({}, path, new Map())).toEqual({
      visible: true,
      operation: undefined,
    });
  });
});
