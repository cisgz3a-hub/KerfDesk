import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import type * as ImageLoaderModule from './image-loader';
import { readImageNaturalSize } from './image-loader';
import { TraceCommitGridNote } from './trace-commit-grid-note';
import type { TracePreviewState } from './use-trace-preview';

vi.mock('./image-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageLoaderModule>()),
  readImageNaturalSize: vi.fn(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FILE = new File([], 'wide.png', { type: 'image/png' });

const SOURCE = {
  bounds: { minX: 0, minY: 0, maxX: 409.6, maxY: 51.2 },
  transform: IDENTITY_TRANSFORM,
} as RasterImage;

function readyPreview(options: TraceOptions): TracePreviewState {
  const result = {
    paths: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    width: 2048,
    height: 256,
  };
  return {
    kind: 'ready',
    svg: '',
    paths: [],
    width: 2048,
    height: 256,
    preparedTrace: {
      request: { file: FILE, options, boundary: null, boundaryMode: 'crop' },
      result,
    },
  } as unknown as TracePreviewState;
}

async function render(preview: TracePreviewState): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<TraceCommitGridNote preview={preview} source={SOURCE} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.mocked(readImageNaturalSize).mockReset();
});

describe('TraceCommitGridNote', () => {
  it('tells the operator the committed trace uses more pixels than the preview', async () => {
    vi.mocked(readImageNaturalSize).mockResolvedValue({ width: 4096, height: 512 });
    const host = await render(readyPreview(TRACE_PRESETS['Line Art']!));
    expect(readImageNaturalSize).toHaveBeenCalledWith(FILE, expect.any(AbortSignal));
    expect(host.textContent).toBe(
      'Preview: 2048 x 256 px. The committed trace uses 4096 x 512 px (the full image), so it can keep detail the preview cannot show.',
    );
  });

  it('stays silent for Photo shading, which keeps the preview grid', async () => {
    vi.mocked(readImageNaturalSize).mockResolvedValue({ width: 4096, height: 512 });
    const host = await render(readyPreview(TRACE_PRESETS['Photo shading']!));
    expect(host.textContent).toBe('');
  });

  it('stays silent until a preview is ready, and when the size cannot be read', async () => {
    vi.mocked(readImageNaturalSize).mockRejectedValue(new Error('unsupported'));
    expect((await render({ kind: 'idle' })).textContent).toBe('');
    expect(readImageNaturalSize).not.toHaveBeenCalled();
    expect((await render(readyPreview(TRACE_PRESETS['Line Art']!))).textContent).toBe('');
  });
});
