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
  assert(state.zoomLevel === 100, 'zoom level starts at 100');
  assert(state.canvasSize.width === 800, 'canvas width starts at fallback width');
  assert(state.canvasSize.height === 600, 'canvas height starts at fallback height');
  assert(state.previewMode === false, 'preview mode starts off');
  assert(state.bedTabLayout.bedScreenX === 0, 'bed tab layout starts at x=0');
  assert(state.bedTabLayout.bedScreenY === 0, 'bed tab layout starts at y=0');
  assert(state.bedTabLayout.zoom === 1.5, 'bed tab layout starts at default zoom');
}

{
  const store = createViewportStore();
  store.getState().setZoomLevel(75);
  assert(store.getState().zoomLevel === 75, 'zoom level updates');

  store.getState().setCanvasSize({ width: 1200, height: 700 });
  assert(store.getState().canvasSize.width === 1200, 'canvas width updates');
  assert(store.getState().canvasSize.height === 700, 'canvas height updates');

  store.getState().togglePreviewMode();
  assert(store.getState().previewMode === true, 'preview mode toggles on');
  store.getState().setPreviewMode(false);
  assert(store.getState().previewMode === false, 'preview mode setter turns off');

  store.getState().setBedTabLayout({ bedScreenX: 10, bedScreenY: 20, zoom: 2 });
  const changed = store.getState().bedTabLayout;
  assert(changed.bedScreenX === 10, 'bed tab layout x updates');
  assert(changed.bedScreenY === 20, 'bed tab layout y updates');
  assert(changed.zoom === 2, 'bed tab layout zoom updates');

  store.getState().setBedTabLayout({ bedScreenX: 10, bedScreenY: 20, zoom: 2 });
  assert(store.getState().bedTabLayout === changed, 'same bed tab layout preserves object identity');

  const measuredCanvasSize = store.getState().canvasSize;
  store.getState().resetViewport();
  assert(store.getState().zoomLevel === viewportInitialState.zoomLevel, 'reset restores zoom level');
  assert(store.getState().canvasSize === measuredCanvasSize, 'reset preserves measured canvas size object');
  assert(store.getState().canvasSize.width === 1200, 'reset preserves measured canvas width');
  assert(store.getState().canvasSize.height === 700, 'reset preserves measured canvas height');
  assert(store.getState().previewMode === viewportInitialState.previewMode, 'reset restores preview mode');
  assert(store.getState().bedTabLayout === viewportInitialState.bedTabLayout, 'reset restores initial layout object');
}
