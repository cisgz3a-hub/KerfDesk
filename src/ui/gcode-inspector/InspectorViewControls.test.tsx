import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { InspectorViewControls } from './InspectorViewControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('disables camera modes, presets, ortho, fit and capture when the viewer is unavailable', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSelectView = vi.fn();
  const onCameraModeChange = vi.fn();
  const onFit = vi.fn();
  const onCapture = vi.fn();
  const onProjectionChange = vi.fn();
  try {
    act(() =>
      root.render(
        <InspectorViewControls
          cameraMode="auto"
          onCameraModeChange={onCameraModeChange}
          onSelectView={onSelectView}
          onFit={onFit}
          projection="perspective"
          onProjectionChange={onProjectionChange}
          onCapture={onCapture}
          disabled
        />,
      ),
    );
    const buttons = Array.from(host.querySelectorAll('button'));
    expect(buttons).toHaveLength(10);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      act(() => button.click());
    }
    expect(onSelectView).not.toHaveBeenCalled();
    expect(onCameraModeChange).not.toHaveBeenCalled();
    expect(onFit).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
    expect(onProjectionChange).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it('toggles between perspective and orthographic', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onProjectionChange = vi.fn();
  const render = (projection: 'perspective' | 'orthographic'): void =>
    act(() =>
      root.render(
        <InspectorViewControls
          cameraMode="manual"
          onCameraModeChange={vi.fn()}
          onSelectView={vi.fn()}
          onFit={vi.fn()}
          projection={projection}
          onProjectionChange={onProjectionChange}
          onCapture={vi.fn()}
        />,
      ),
    );
  try {
    render('perspective');
    const ortho = (): HTMLButtonElement | undefined =>
      Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Ortho');
    expect(ortho()?.getAttribute('aria-pressed')).toBe('false');
    act(() => ortho()?.click());
    expect(onProjectionChange).toHaveBeenLastCalledWith('orthographic');
    render('orthographic');
    expect(ortho()?.getAttribute('aria-pressed')).toBe('true');
    act(() => ortho()?.click());
    expect(onProjectionChange).toHaveBeenLastCalledWith('perspective');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
