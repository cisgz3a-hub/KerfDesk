import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore as reset, svgObj } from './test-helpers';

describe('useStore selectObjects', () => {
  beforeEach(() => {
    reset();
  });

  it('replaces the current selection with ordered ids', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#f00']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0f0']));
    useStore.getState().importSvgObject(svgObj('O3', ['#00f']));

    useStore.getState().selectObjects(['O2', 'O3']);

    const s = useStore.getState();
    expect(s.selectedObjectId).toBe('O2');
    expect([...s.additionalSelectedIds]).toEqual(['O3']);
  });

  it('can add marquee hits to the current multi-selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#f00']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0f0']));
    useStore.getState().importSvgObject(svgObj('O3', ['#00f']));
    useStore.getState().selectObjects(['O1', 'O2']);

    useStore.getState().selectObjects(['O3'], { additive: true });

    const s = useStore.getState();
    expect(s.selectedObjectId).toBe('O1');
    expect([...s.additionalSelectedIds]).toEqual(['O2', 'O3']);
  });
});
