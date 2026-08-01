import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { GcodeInspectorDialog } from './GcodeInspectorDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PROGRAM = ['G21 G90', 'M3 S500', 'G0 X10 Y0', 'G1 X20 Y0 F600', 'M5', 'M2'].join('\n');

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(element: JSX.Element): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(element);
  });
}

// The scene shell dynamically imports three before it can fall back. Poll in
// SHORT act rounds — each act exit flushes pending state, so the predicate
// sees fresh DOM; one long act around a waitFor would defer the flush and
// deadlock instead.
async function settleUntil(predicate: () => boolean): Promise<void> {
  for (let round = 0; round < 200; round += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error('settleUntil: predicate never became true');
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  useUiStore.setState({ modalDepth: 0 });
  vi.unstubAllGlobals();
});

describe('GcodeInspectorDialog', () => {
  it('is an application modal that isolates global commands and owns initial focus', () => {
    mount(
      <GcodeInspectorDialog
        programName="part.nc"
        source={{ kind: 'text', text: PROGRAM }}
        machineKind="laser"
        onClose={() => undefined}
      />,
    );

    const dialog = container?.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(useUiStore.getState().modalDepth).toBe(1);
    expect(document.activeElement?.textContent).toBe('Close');
  });

  it('parses the program, shows stats, and falls back gracefully without WebGL', async () => {
    mount(
      <GcodeInspectorDialog
        programName="part.nc"
        source={{ kind: 'text', text: PROGRAM }}
        machineKind="laser"
        onClose={() => undefined}
      />,
    );
    await settleUntil(() => (container?.textContent ?? '').includes('3D view unavailable'));
    await settleUntil(() => (container?.textContent ?? '').includes('G21 G90'));
    const text = container?.textContent ?? '';
    expect(text).toContain('part.nc');
    expect(text).toContain('2 shown segments');
    expect(text).not.toContain('Open in 2D simulator');
  }, 15_000);

  it('shows the parse error for non-G-code input', async () => {
    mount(
      <GcodeInspectorDialog
        programName="prose.txt"
        source={{ kind: 'text', text: 'hello world\nthis is prose' }}
        machineKind="laser"
        onClose={() => undefined}
      />,
    );
    await settleUntil(() => (container?.textContent ?? '').includes('does not look like G-code'));
  });

  it('parses a Blob through the disclosed main-thread fallback when Worker construction fails', async () => {
    vi.stubGlobal('Worker', function WorkerUnavailable(): never {
      throw new Error('workers blocked');
    });
    const readBlob = vi.fn(async () => PROGRAM);
    const blob = { size: PROGRAM.length, text: readBlob } as unknown as Blob;
    mount(
      <GcodeInspectorDialog
        programName="fallback.nc"
        source={{ kind: 'blob', blob }}
        machineKind="laser"
        onClose={() => undefined}
      />,
    );

    await settleUntil(() => (container?.textContent ?? '').includes('2 shown segments'));
    await settleUntil(() => (container?.textContent ?? '').includes('G21 G90'));
    expect(readBlob).toHaveBeenCalledOnce();
    expect(container?.textContent ?? '').toMatch(/may be unresponsive/i);
    expect(container?.textContent ?? '').toContain('2 shown segments');
    expect(container?.textContent ?? '').not.toContain('Source unavailable');
  });

  it('offers the 2D simulator handoff only in CNC mode', () => {
    mount(
      <GcodeInspectorDialog
        programName="part.nc"
        source={{ kind: 'text', text: PROGRAM }}
        machineKind="cnc"
        onOpen2dSimulator={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(container?.textContent ?? '').toContain('Open in 2D simulator');
  });
});
