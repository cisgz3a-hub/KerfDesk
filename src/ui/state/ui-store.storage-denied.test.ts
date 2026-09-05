import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

it('initializes the UI and retains session preferences when localStorage access is denied', async () => {
  vi.resetModules();
  vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Storage disabled for this origin', 'SecurityError');
  });
  const { useUiStore } = await import('./ui-store');
  expect(useUiStore.getState().showCanvasStartMarkers).toBe(true);
  useUiStore.getState().setShowCanvasStartMarkers(false);
  expect(useUiStore.getState().showCanvasStartMarkers).toBe(false);
  useUiStore.getState().setShowCanvasStartMarkers(true);
  expect(useUiStore.getState().showCanvasStartMarkers).toBe(true);
});
