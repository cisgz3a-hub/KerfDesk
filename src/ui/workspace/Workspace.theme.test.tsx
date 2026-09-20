import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { canvasTheme } from '../theme/canvas-theme';
import * as drawing from './draw-scene';
import { Workspace } from './Workspace';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('repaints an unchanged workspace and invalidates its preview background when the OS theme changes', async () => {
  let dark = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
  useStore.setState({ project: createProject(), previewMode: false });
  useUiStore.setState({ draftShape: null, penDraft: null });
  const draw = vi.spyOn(drawing, 'drawScene');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workspace />));
    const before = draw.mock.calls.at(-1);
    const count = draw.mock.calls.length;
    const lightBed = canvasTheme.bedFill;
    expect(before).toBeDefined();

    await act(async () => {
      dark = true;
      listeners.forEach((listener) => listener());
    });
    const after = draw.mock.calls.at(-1);
    expect(draw.mock.calls.length).toBeGreaterThan(count);
    expect(canvasTheme.bedFill).not.toBe(lightBed);
    expect(after?.[3]).toBe(before?.[3]);
    expect(after?.[4].previewBackgroundKey).not.toBe(before?.[4].previewBackgroundKey);

    await act(async () => {
      dark = false;
      listeners.forEach((listener) => listener());
    });
    expect(canvasTheme.bedFill).toBe(lightBed);
  } finally {
    await act(async () => root.unmount());
  }
  expect(listeners.size).toBe(0);
});
