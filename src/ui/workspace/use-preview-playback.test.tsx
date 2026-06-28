import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Toolpath } from '../../core/job';
import { useUiStore } from '../state/ui-store';
import { usePreviewPlayback } from './use-preview-playback';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const toolpath: Toolpath = {
  totalLength: 100,
  steps: [
    {
      kind: 'cut',
      color: '#000000',
      length: 100,
      polyline: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    },
  ],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let rafCallbacks: FrameRequestCallback[] = [];
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

beforeEach(() => {
  rafCallbacks = [];
  vi.useFakeTimers();
  globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  globalThis.cancelAnimationFrame = vi.fn();
  useUiStore.getState().setScrubberT(0);
  useUiStore.getState().setPreviewPlaying(false);
  useUiStore.getState().setPreviewPlaybackSpeed('normal');
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  host?.remove();
  host = null;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  vi.useRealTimers();
});

describe('usePreviewPlayback', () => {
  it('advances the preview scrubber while route playback is running', async () => {
    await renderHarness(true, toolpath);

    await act(async () => useUiStore.getState().setPreviewPlaying(true));
    await flushNextFrame(0);
    await flushNextFrame(15_000);

    expect(useUiStore.getState().scrubberT).toBeCloseTo(0.5, 2);
  });

  it('stops at the end of the route', async () => {
    await renderHarness(true, toolpath);

    await act(async () => useUiStore.getState().setPreviewPlaying(true));
    await flushNextFrame(0);
    await flushNextFrame(30_500);

    expect(useUiStore.getState().scrubberT).toBe(1);
    expect(useUiStore.getState().previewPlaying).toBe(false);
  });

  it('pauses playback when preview mode exits', async () => {
    await renderHarness(true, toolpath);

    await act(async () => useUiStore.getState().setPreviewPlaying(true));
    await renderHarness(false, toolpath);

    expect(useUiStore.getState().previewPlaying).toBe(false);
  });
});

async function renderHarness(previewMode: boolean, previewToolpath: Toolpath | null): Promise<void> {
  if (host === null) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root?.render(<Harness previewMode={previewMode} toolpath={previewToolpath} />);
  });
}

function Harness(props: {
  readonly previewMode: boolean;
  readonly toolpath: Toolpath | null;
}): JSX.Element | null {
  usePreviewPlayback(props.previewMode, props.toolpath);
  return null;
}

async function flushNextFrame(time: number): Promise<void> {
  const callback = rafCallbacks.shift();
  if (callback === undefined) throw new Error('requestAnimationFrame callback missing');
  await act(async () => {
    callback(time);
  });
}
