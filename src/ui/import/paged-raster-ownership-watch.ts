// Page-backed raster pages outlive the scene object that owns them, so the
// lifecycle observer has to see every store transition, not just the import.
//
// This lives outside store.ts on purpose. Subscribing at store-module scope
// made the store file exceed the 400-line hard cap once main grew, and it also
// armed the subscription in every jsdom test that merely imports the store.
// Wiring it from the composition root (ADR-011) keeps both properties: one
// subscription in the running app, none in unit tests.
import { useStore } from '../state/store';
import { observePagedRasterOwnershipTransition } from './paged-raster-asset-lifecycle';

/** Start observing store transitions for page-backed raster ownership. Returns the unsubscribe. */
export function watchPagedRasterOwnership(): () => void {
  return useStore.subscribe((current, previous) => {
    void observePagedRasterOwnershipTransition(previous, current);
  });
}
