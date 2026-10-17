import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type TracedImage } from '../../../core/scene';
import { DEFAULT_TRACE_OPTIONS } from '../../../core/trace';
import { useJigTraceCommit } from './jig-trace-commit';
import { buildJigTraceObject } from './jig-trace-import';

vi.mock('./jig-trace-import', () => ({ buildJigTraceObject: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const file = new File(['a'], 'logo.png');
const options = DEFAULT_TRACE_OPTIONS;
const source = { file, dataUrl: '', natural: { width: 10, height: 10 }, density: null };
const traced: TracedImage = {
  kind: 'traced-image',
  id: 'trace',
  source: file.name,
  paths: [],
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  transform: IDENTITY_TRANSFORM,
};
const preparedTrace = {
  request: { file, options, boundary: null, boundaryMode: 'crop' as const },
  result: { paths: [], bounds: traced.bounds, width: 10, height: 10 },
};
const onImport = vi.fn();
let host: HTMLDivElement;
let root: Root;
let state: ReturnType<typeof useJigTraceCommit>;
let props: Parameters<typeof useJigTraceCommit>[0];
let resolve: (object: TracedImage) => void;

function Harness(): null {
  state = useJigTraceCommit(props);
  return null;
}
beforeEach(() => {
  onImport.mockClear();
  vi.mocked(buildJigTraceObject).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  props = {
    project: createProject(),
    source,
    options,
    onImport,
    onBusyChange: vi.fn(),
    preview: { kind: 'ready', svg: '<svg/>', paths: [], width: 10, height: 10, preparedTrace },
  };
  host = document.createElement('div');
  root = createRoot(host);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.clearAllMocks();
});

describe('inline jig trace commit fencing', () => {
  it('publishes once and suppresses repeated clicks while pending', async () => {
    let pending!: Promise<void>;
    act(() => {
      pending = state.commit();
      void state.commit();
    });
    expect(buildJigTraceObject).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(traced);
      await pending;
    });
    expect(onImport).toHaveBeenCalledExactlyOnceWith(traced);
    expect(state.busy).toBe(false);
  });

  it('drops the result if the jig changes during preparation', async () => {
    let pending!: Promise<void>;
    act(() => {
      pending = state.commit();
    });
    props = { ...props, project: createProject() };
    act(() => root.render(<Harness />));
    await act(async () => {
      resolve(traced);
      await pending;
    });
    expect(onImport).not.toHaveBeenCalled();
    expect(state.error).toContain('changed');
  });

  it('drops the result after the trace control unmounts', async () => {
    let pending!: Promise<void>;
    act(() => {
      pending = state.commit();
    });
    act(() => root.render(null));
    await act(async () => {
      resolve(traced);
      await pending;
    });
    expect(onImport).not.toHaveBeenCalled();
  });
});
