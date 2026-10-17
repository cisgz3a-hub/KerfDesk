import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadJigTraceSource, type JigTraceSource } from './jig-trace-import';
import { useJigTraceSource } from './jig-trace-source';

vi.mock('./jig-trace-import', () => ({ loadJigTraceSource: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let state: ReturnType<typeof useJigTraceSource>;
function Harness(): null {
  state = useJigTraceSource();
  return null;
}
function source(file: File): JigTraceSource {
  return {
    file,
    dataUrl: 'data:image/png;base64,AA==',
    natural: { width: 10, height: 10 },
    density: null,
  };
}
beforeEach(() => {
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.resetAllMocks();
});

describe('inline jig trace source requests', () => {
  it('keeps the newer uploaded image when an older load finishes last', async () => {
    const first = new File(['a'], 'first.png');
    const second = new File(['b'], 'second.png');
    let finishFirst!: (value: JigTraceSource) => void;
    vi.mocked(loadJigTraceSource).mockImplementation((file) =>
      file === first
        ? new Promise((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve(source(file)),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = state.load(first);
    });
    await act(async () => {
      await state.load(second);
    });
    await act(async () => {
      finishFirst(source(first));
      await pending;
    });
    expect(state.source?.file).toBe(second);
    expect(state.loading).toBe(false);
  });

  it('reports failed loading and allows another upload', async () => {
    vi.mocked(loadJigTraceSource).mockRejectedValueOnce(new Error('Image could not be decoded'));
    await act(async () => {
      await state.load(new File(['bad'], 'bad.png'));
    });
    expect(state.error).toContain('could not be decoded');
    expect(state.loading).toBe(false);
    vi.mocked(loadJigTraceSource).mockImplementation(async (file) => source(file));
    await act(async () => {
      await state.load(new File(['good'], 'good.png'));
    });
    expect(state.source?.file.name).toBe('good.png');
    expect(state.error).toBeNull();
  });
});
