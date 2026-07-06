import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calculateFeeds } from '../../core/cnc';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  resetStore();
  useStore.getState().setMachineKind('cnc');
});
afterEach(() => resetStore());

function cncStockMaterial(): string | undefined {
  const machine = useStore.getState().project.machine;
  return machine?.kind === 'cnc' ? machine.stock.materialKey : undefined;
}

describe('applyCncStockMaterial (ADR-112)', () => {
  it('sets the stock material, fills the layer feeds, and is one undoable step', () => {
    useStore.getState().createManualLayer('#00aa00');
    const before = useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin;

    useStore.getState().applyCncStockMaterial('hardwood');

    const feeds = calculateFeeds({
      material: 'hardwood',
      bitDiameterMm: 3.175,
      flutes: 2,
      rpm: 12000,
    });
    if (feeds.kind === 'error') throw new Error(feeds.reason);
    expect(cncStockMaterial()).toBe('hardwood');
    expect(useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin).toBe(feeds.feedMmPerMin);
    expect(useStore.getState().dirty).toBe(true);

    useStore.getState().undo();
    expect(cncStockMaterial()).toBeUndefined();
    expect(useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin).toBe(before);
  });

  it('clearing to null drops the stock material without erasing layer feeds', () => {
    useStore.getState().createManualLayer('#00aa00');
    useStore.getState().applyCncStockMaterial('hardwood');
    const filledFeed = useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin;

    useStore.getState().applyCncStockMaterial(null);
    expect(cncStockMaterial()).toBeUndefined();
    expect(useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin).toBe(filledFeed);
  });
});
