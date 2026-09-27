import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { TRACE_PRESETS } from '../../core/trace';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { chosenImageHandle, settlePicker } from './multi-file-trace-dialog.test-helpers';
import { MultiFileTraceDialogHost } from './MultiFileTraceDialog';
import type * as multiFileTraceAction from './multi-file-trace-action';
import { runMultiFileTrace } from './multi-file-trace-action';

vi.mock('./multi-file-trace-action', async (importOriginal) => ({
  ...(await importOriginal<typeof multiFileTraceAction>()),
  runMultiFileTrace: vi.fn(async () => undefined),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.mocked(runMultiFileTrace).mockClear();
});

function choose(label: string, value: string): void {
  const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (select === null) throw new Error(`No select labelled ${label}.`);
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Multi-File Trace dialog', () => {
  it('opens each picker inside its own click and hands the chosen settings to the batch', async () => {
    const pickFilesForOpen = vi.fn(async () => [chosenImageHandle('a.png')]);
    const written: string[] = [];
    const reserveSaveDirectory = vi.fn(async () => ({
      file: (name: string) => ({ displayName: name, write: async () => void written.push(name) }),
    }));
    const onClose = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    const mountedRoot = createRoot(host);
    root = mountedRoot;
    act(() =>
      mountedRoot.render(
        <PlatformProvider
          adapter={{ ...mockPlatform(), pickFilesForOpen, reserveSaveDirectory } as PlatformAdapter}
        >
          <MultiFileTraceDialogHost onClose={onClose} />
        </PlatformProvider>,
      ),
    );
    // SVG offers per-island grouping; DXF has no groups, so the option hides.
    expect(document.querySelector('input[type="checkbox"]')).not.toBeNull();
    choose('Trace preset', 'Centerline');
    choose('Output format', 'dxf');
    choose('Coordinate precision', '0.1');
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();

    const button = (text: string): HTMLButtonElement | undefined =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === text);
    expect(button('Trace...')?.disabled).toBe(true);
    act(() => {
      button('Choose Images...')?.click();
      // Still inside the click dispatch: no await has run, so the browser's
      // user activation still covers the file picker.
      expect(pickFilesForOpen).toHaveBeenCalledTimes(1);
    });
    await settlePicker();
    expect(button('Trace...')?.disabled).toBe(false);
    expect(document.body.textContent).toContain('1 image chosen: a.png');
    act(() => {
      button('Trace...')?.click();
      // The output folder is reserved inside the Trace click (rank 21).
      expect(reserveSaveDirectory).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.waitFor(() => expect(runMultiFileTrace).toHaveBeenCalledTimes(1));
    });
    const [files, , deps] = vi.mocked(runMultiFileTrace).mock.calls[0] ?? [];
    expect(files?.map((file) => file.name)).toEqual(['a.png']);
    expect(deps?.signal).toBeInstanceOf(AbortSignal);
    await deps?.write?.({
      filename: 'a-trace.dxf',
      format: 'dxf',
      text: '0',
      pathCount: 1,
      sourceIndex: 0,
    });
    expect(written).toEqual(['a-trace.dxf']);
    expect(deps?.options).toBe(TRACE_PRESETS['Centerline']);
    expect(deps?.output).toEqual({ format: 'dxf', groupContours: false, precisionMm: 0.1 });

    // The next batch in the session starts from the last settings.
    act(() => mountedRoot.render(<></>));
    act(() =>
      mountedRoot.render(
        <PlatformProvider adapter={{ ...mockPlatform(), pickFilesForOpen }}>
          <MultiFileTraceDialogHost onClose={onClose} />
        </PlatformProvider>,
      ),
    );
    const value = (label: string): string | undefined =>
      document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)?.value;
    expect(value('Trace preset')).toBe('Centerline');
    expect(value('Output format')).toBe('dxf');
    expect(value('Coordinate precision')).toBe('0.1');
  });
});
