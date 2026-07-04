import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore as reset, svgObj } from './test-helpers';

describe('useStore selectObjects', () => {
  beforeEach(() => {
    reset();
  });

  it('replaces the current selection with ordered ids', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#00ff00']));
    useStore.getState().importSvgObject(svgObj('O3', ['#0000ff']));

    useStore.getState().selectObjects(['O2', 'O3']);

    const s = useStore.getState();
    expect(s.selectedObjectId).toBe('O2');
    expect([...s.additionalSelectedIds]).toEqual(['O3']);
  });

  it('can add marquee hits to the current multi-selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#00ff00']));
    useStore.getState().importSvgObject(svgObj('O3', ['#0000ff']));
    useStore.getState().selectObjects(['O1', 'O2']);

    useStore.getState().selectObjects(['O3'], { additive: true });

    const s = useStore.getState();
    expect(s.selectedObjectId).toBe('O1');
    expect([...s.additionalSelectedIds]).toEqual(['O2', 'O3']);
  });

  it('filters locked objects out of direct multi-selection requests', () => {
    useStore.getState().importSvgObject({ ...svgObj('O1', ['#ff0000']), locked: true });
    useStore.getState().importSvgObject(svgObj('O2', ['#00ff00']));

    useStore.getState().selectObjects(['O1', 'O2']);

    const s = useStore.getState();
    expect(s.selectedObjectId).toBe('O2');
    expect([...s.additionalSelectedIds]).toEqual([]);
  });
});
