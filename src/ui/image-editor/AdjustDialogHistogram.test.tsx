// Regression guard for perf audit S5-P2-1: the Levels/Threshold histogram
// is a whole-document scan, so it runs once per dialog source, never once
// per slider step (an inline canvas ref recomputed it on every render).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ImageAdjust from '../../core/image-adjust';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { AdjustDialogPanel } from './AdjustDialog';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

const histogramCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../core/image-adjust', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageAdjust>();
  return {
    ...actual,
    lumaHistogram: (...args: Parameters<typeof actual.lumaHistogram>) => {
      histogramCalls.count += 1;
      return actual.lumaHistogram(...args);
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  histogramCalls.count = 0;
  useImageEditorStore.setState({
    session: createSession('image', 'image.png', createRgbaBuffer(64, 48), {
      minX: 0,
      minY: 0,
      maxX: 64,
      maxY: 48,
    }),
    transform: null,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  useAdjustDialogStore.getState().cancel();
  useImageEditorStore.setState({ session: null });
});

describe('adjustment histogram', () => {
  it.each([
    ['levels', 'gamma', [1.1, 1.2, 1.3, 1.4, 1.5]],
    ['threshold', 'level', [100, 110, 120, 130, 140]],
  ] as const)('%s scans the document once across slider steps', async (id, key, values) => {
    useAdjustDialogStore.getState().open(id);
    await act(async () => {
      root.render(<AdjustDialogPanel />);
    });
    for (const value of values) {
      await act(async () => {
        useAdjustDialogStore.getState().setParams({ [key]: value });
      });
    }
    expect(
      host.querySelector('canvas[aria-label="Luma histogram of the current image"]'),
    ).not.toBeNull();
    expect(histogramCalls.count).toBe(1);
  });
});
