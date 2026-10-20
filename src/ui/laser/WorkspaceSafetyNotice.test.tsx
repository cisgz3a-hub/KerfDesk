import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { ArtworkNumberingPrompt } from '../workspace/ArtworkNumberingPrompt';
import { LaserTabHint } from '../workspace/LaserTabHint';
import { MachineConnectionToolbar } from './MachineConnectionToolbar';
import { WorkspaceSafetyNotice } from './WorkspaceSafetyNotice';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

// Separate hosts stand in for the top bar and the canvas accessories.
let toolbarHost: HTMLDivElement;
let canvasHost: HTMLDivElement;
let rootHost: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    motionOperation: null,
    controllerOperation: null,
    safetyNotice: null,
  });
  toolbarHost = document.createElement('div');
  canvasHost = document.createElement('div');
  rootHost = document.createElement('div');
  document.body.append(toolbarHost, canvasHost, rootHost);
  root = createRoot(rootHost);
  act(() =>
    root.render(
      <PlatformProvider adapter={platform}>
        {createPortal(<MachineConnectionToolbar />, toolbarHost)}
        {createPortal(<WorkspaceSafetyNotice />, canvasHost)}
      </PlatformProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  toolbarHost.remove();
  canvasHost.remove();
  rootHost.remove();
  useLaserStore.setState({ safetyNotice: null });
  useUiStore.setState({ toolMode: { kind: 'select' } });
  useUiStore.getState().resetArtworkRunOrder();
  resetStore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function raiseWriteFailed(): void {
  act(() =>
    useLaserStore.setState({
      safetyNotice: { kind: 'write-failed', action: 'jog', message: 'Jog write failed.' },
    }),
  );
}

function stylesheetZIndex(path: string, selector: string): number {
  // The rule that starts a line, not a nested or descendant use of the class.
  const css = `\n${readFileSync(path, 'utf8')}`;
  const start = css.indexOf(`\n${selector} {`);
  const rule = start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  return Number(rule.match(/z-index: (\d+);/)?.[1]);
}

async function flushMeasurement(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(32);
  });
}

describe('WorkspaceSafetyNotice', () => {
  it('renders nothing until the store raises a notice', () => {
    expect(canvasHost.childElementCount).toBe(0);
  });

  it('floats a failed write over the canvas and keeps it out of the machine toolbar', () => {
    act(() =>
      useLaserStore.setState({
        safetyNotice: { kind: 'write-failed', action: 'jog', message: 'Jog write failed.' },
      }),
    );

    expect(toolbarHost.querySelector('[role="alert"]')).toBeNull();
    const alert = canvasHost.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Controller write failed');
    expect(alert?.textContent).toContain('I made the machine safe');
    // Its stylesheet floats it over the canvas, so it takes no layout space.
    const toast = alert?.parentElement;
    expect(toast?.className).toBe('lf-safety-notice-toast');
    expect(toast?.parentElement?.className).toBe('lf-safety-notice-anchor');
  });
});

describe('WorkspaceSafetyNotice placement', () => {
  // Nothing between the canvas and its overlays starts a stacking context, so
  // these z-indexes compete directly: the run-order prompt shares the top
  // centre, and the tool hints reach up from the bottom left of a short canvas.
  it('draws above the in-canvas hints and below modal dialogs', () => {
    const hintsHost = document.createElement('div');
    document.body.append(hintsHost);
    const hintsRoot = createRoot(hintsHost);
    act(() => {
      useUiStore.getState().startArtworkNumbering([]);
      useUiStore.setState({
        toolMode: { kind: 'laser-tabs', layerColor: '#ff0000', operationId: 'cut' },
      });
      hintsRoot.render(
        <>
          <ArtworkNumberingPrompt />
          <LaserTabHint />
        </>,
      );
    });
    const hints = [...hintsHost.querySelectorAll<HTMLElement>('[role="status"]')];
    act(() => hintsRoot.unmount());
    hintsHost.remove();

    expect(hints.map((hint) => hint.textContent)).toEqual([
      expect.stringContaining('Click artwork for run #1'),
      expect.stringContaining('Click the outline to add a tab'),
    ]);
    const notice = stylesheetZIndex(
      'src/ui/laser/workspace-safety-notice.css',
      '.lf-safety-notice-anchor',
    );
    const hintLayers = [
      ...hints.map((hint) => Number(hint.style.zIndex)),
      stylesheetZIndex('src/ui/workspace/trace-parts.css', '.lf-trace-parts-hint'),
    ];
    expect(hintLayers.every(Number.isFinite)).toBe(true);
    for (const layer of hintLayers) expect(notice).toBeGreaterThan(layer);
    const tokens = readFileSync('src/ui/theme/tokens.css', 'utf8');
    expect(notice).toBeLessThan(Number(tokens.match(/--lf-z-dialog: (\d+);/)?.[1]));
  });

  // The Live Motion popup is fixed over the lower centre of the window during a
  // job, jog or Frame and is drawn above everything, so on a short window it
  // covered the notice's buttons, "I made the machine safe" included.
  it('stops above the Live Motion popup and lets go when it closes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('innerHeight', 720);
    const popup = document.createElement('section');
    popup.setAttribute('aria-label', 'Live Motion');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === popup) return new DOMRect(340, 570, 720, 68);
      if (this.className === 'lf-safety-notice-toast') return new DOMRect(330, 132, 420, 500);
      return new DOMRect(0, 0, 0, 0);
    });
    document.body.append(popup);
    raiseWriteFailed();
    const toast = canvasHost.querySelector<HTMLElement>('.lf-safety-notice-toast');
    // Window 720 high, less the popup's top at 570 and a 12 px gap, less the notice's top at 132.
    expect(toast?.style.getPropertyValue('--lf-safety-notice-room')).toBe('426px');

    popup.remove();
    await flushMeasurement();
    expect(toast?.style.getPropertyValue('--lf-safety-notice-room')).toBe('');
  });
});
