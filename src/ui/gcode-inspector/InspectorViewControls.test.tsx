import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { InspectorViewControls } from './InspectorViewControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('disables camera modes, presets, fit and capture when the viewer is unavailable', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSelectView = vi.fn();
  const onCameraModeChange = vi.fn();
  const onFit = vi.fn();
  const onCapture = vi.fn();
  try {
    act(() =>
      root.render(
        <InspectorViewControls
          cameraMode="auto"
          onCameraModeChange={onCameraModeChange}
          onSelectView={onSelectView}
          onFit={onFit}
          onCapture={onCapture}
          disabled
        />,
      ),
    );
    const buttons = Array.from(host.querySelectorAll('button'));
    expect(buttons).toHaveLength(9);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      act(() => button.click());
    }
    expect(onSelectView).not.toHaveBeenCalled();
    expect(onCameraModeChange).not.toHaveBeenCalled();
    expect(onFit).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
