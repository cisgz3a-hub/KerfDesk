import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useUiStore } from '../state/ui-store';
import { setAppThemePreference } from '../theme/app-theme';
import { canvasTheme } from '../theme/canvas-theme';
import * as motion from './draw-canvas-motion';
import * as drawing from './draw-scene';
import { Workspace } from './Workspace';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  setAppThemePreference('light');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ADR-339: the theme is the application's own choice, so the repaint is driven
// by the preference. The matchMedia stub stays because `subscribeAppTheme`
// still attaches a desktop listener (that is how 'system' tracks the OS), and
// this test is the thing that proves the listener is released on unmount.
it('repaints an unchanged workspace and invalidates its preview background when the theme changes', async () => {
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
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

    await act(async () => setAppThemePreference('dark'));
    const after = draw.mock.calls.at(-1);
    expect(draw.mock.calls.length).toBeGreaterThan(count);
    expect(canvasTheme.bedFill).not.toBe(lightBed);
    // Same project, same scene — only the palette moved.
    expect(after?.[3]).toBe(before?.[3]);
    expect(after?.[4].previewBackgroundKey).not.toBe(before?.[4].previewBackgroundKey);

    await act(async () => setAppThemePreference('light'));
    expect(canvasTheme.bedFill).toBe(lightBed);
  } finally {
    await act(async () => root.unmount());
  }
  expect(listeners.size).toBe(0);
});

// The motion layer (start markers, frame perimeter, planned route) paints from
// the same scheme-dependent palette but repaints only when its overlay object
// changes, so an idle, unchanged plan must still be redrawn on a theme switch.
it('repaints the idle motion markers when the theme changes', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const decoded = deserializeProject(readFileSync('e2e/fixtures/project-basic.lf2', 'utf8'));
  if (decoded.kind !== 'ok') throw new Error(`Fixture failed to load: ${decoded.kind}`);
  useStore.setState({
    project: decoded.project,
    previewMode: false,
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
  useLaserStore.setState(initialLaserState());
  useUiStore.setState({ draftShape: null, penDraft: null });
  const drawMotion = vi.spyOn(motion, 'drawCanvasMotionOverlay');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Workspace />));
    for (let attempt = 0; attempt < 50 && drawMotion.mock.calls.length === 0; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
    expect(drawMotion).toHaveBeenCalled();
    const count = drawMotion.mock.calls.length;
    const lightPlanned = canvasTheme.burnPlanned;

    await act(async () => setAppThemePreference('dark'));
    expect(canvasTheme.burnPlanned).not.toBe(lightPlanned);
    expect(drawMotion.mock.calls.length).toBeGreaterThan(count);
  } finally {
    await act(async () => root.unmount());
  }
});
