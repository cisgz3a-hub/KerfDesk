import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { snapContextFor } from './workspace-pointer-snap';

const origin = { x: 0, y: 0 };

afterEach(() => {
  useUiStore.setState({ penDraft: null });
});

describe('snapContextFor', () => {
  it('snaps node drags against the scene as it was, and draw and measure drags freely', () => {
    const nodeDrag = { kind: 'path-node', startScenePoint: origin } as const;

    expect(snapContextFor(nodeDrag, { kind: 'select' }, false)).toEqual({
      kind: 'node',
      drag: nodeDrag,
    });
    expect(
      snapContextFor(
        { kind: 'draw', shape: 'rect', startScenePoint: origin },
        { kind: 'draw', shape: 'rect' },
        false,
      ),
    ).toEqual({ kind: 'free', constrained: false });
    expect(
      snapContextFor({ kind: 'measure', startScenePoint: origin }, { kind: 'measure' }, true),
    ).toEqual({ kind: 'free', constrained: true });
  });

  it('leaves moves (snapped elsewhere), pans and marquees alone', () => {
    expect(
      snapContextFor(
        { kind: 'move', objectId: 'a', startScenePoint: origin, startTx: 0, startTy: 0 },
        { kind: 'select' },
        false,
      ),
    ).toEqual({ kind: 'none' });
    expect(snapContextFor(null, { kind: 'select' }, false)).toEqual({ kind: 'none' });
  });

  it('follows a hovering draw or measure tool, with Shift constraining only a pen line', () => {
    expect(snapContextFor(null, { kind: 'measure' }, true)).toEqual({
      kind: 'free',
      constrained: false,
    });
    expect(snapContextFor(null, { kind: 'draw', shape: 'rect' }, true)).toEqual({
      kind: 'free',
      constrained: false,
    });
    expect(snapContextFor(null, { kind: 'draw', shape: 'polyline' }, true)).toEqual({
      kind: 'free',
      constrained: false,
    });

    useUiStore.setState({ penDraft: { vertices: [origin], cursor: null } });
    expect(snapContextFor(null, { kind: 'draw', shape: 'polyline' }, true)).toEqual({
      kind: 'free',
      constrained: true,
    });
  });
});
