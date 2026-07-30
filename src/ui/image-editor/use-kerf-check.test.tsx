import fc from 'fast-check';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { useStore } from '../state';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import { useKerfCheck } from './use-kerf-check';

// React's test-only act marker is absent from the standard globalThis type.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLOR = '#808080';
const SIZE_PX = 20;
const BOUNDS = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
const DEBOUNCE_MS = 400;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function image(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: SIZE_PX,
    pixelHeight: SIZE_PX,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color: COLOR,
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAA=',
  };
}

function project(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [image('R1')],
      layers: [
        {
          ...createLayer({ id: 'kerf-layer', color: COLOR, mode: 'image' }),
          dotWidthCorrectionMm: 1,
          linesPerMm: 1,
        },
      ],
    },
  };
}

function session(id: string) {
  const current = createSession(id, `${id}.png`, createRgbaBuffer(SIZE_PX, SIZE_PX), BOUNDS);
  for (let y = 0; y < SIZE_PX; y += 1) {
    const base = (y * SIZE_PX + 2) * 4;
    current.doc.data[base] = 0;
    current.doc.data[base + 1] = 0;
    current.doc.data[base + 2] = 0;
  }
  return current;
}

function Harness(): JSX.Element {
  const check = useKerfCheck();
  return <output>{check?.removedPixels ?? 'none'}</output>;
}

beforeEach(async () => {
  vi.useFakeTimers();
  useStore.setState({ project: project() });
  useImageEditorStore.setState({ session: session('R1') });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Harness />));
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('useKerfCheck', () => {
  it('hides a completed result immediately when the editor session changes', async () => {
    await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS));
    expect(host?.textContent).not.toBe('none');

    await act(async () => useImageEditorStore.setState({ session: session('R2') }));

    expect(host?.textContent).toBe('none');
  });

  it('hides completed results for generated session and project replacements', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('session', 'project'), async (replacement) => {
        await act(async () => {
          useStore.setState({ project: project() });
          useImageEditorStore.setState({ session: session('R1') });
        });
        await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS));
        expect(host?.textContent).not.toBe('none');

        await act(async () => {
          if (replacement === 'session') {
            useImageEditorStore.setState({ session: session('R2') });
          } else {
            useStore.setState({ project: project() });
          }
        });

        expect(host?.textContent).toBe('none');
      }),
      { numRuns: 12 },
    );
  });
});
