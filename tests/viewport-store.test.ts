import {
  createViewportStore,
  viewportInitialState,
} from '../src/ui/stores/viewportStore';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

{
  const store = createViewportStore();
  const state = store.getState();
  assert(state.bedTabLayout.bedScreenX === 0, 'bed tab layout starts at x=0');
  assert(state.bedTabLayout.bedScreenY === 0, 'bed tab layout starts at y=0');
  assert(state.bedTabLayout.zoom === 1.5, 'bed tab layout starts at default zoom');
}

{
  const store = createViewportStore();
  store.getState().setBedTabLayout({ bedScreenX: 10, bedScreenY: 20, zoom: 2 });
  const changed = store.getState().bedTabLayout;
  assert(changed.bedScreenX === 10, 'bed tab layout x updates');
  assert(changed.bedScreenY === 20, 'bed tab layout y updates');
  assert(changed.zoom === 2, 'bed tab layout zoom updates');

  store.getState().setBedTabLayout({ bedScreenX: 10, bedScreenY: 20, zoom: 2 });
  assert(store.getState().bedTabLayout === changed, 'same bed tab layout preserves object identity');

  store.getState().resetViewport();
  assert(store.getState().bedTabLayout === viewportInitialState.bedTabLayout, 'reset restores initial layout object');
}
