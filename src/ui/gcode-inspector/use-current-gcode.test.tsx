import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { PlatformProvider } from '../app/platform-context';
import type {
  InspectCurrentGcodeOptions,
  InspectCurrentGcodeResult,
} from '../app/inspect-current-gcode-action';
import { useStore } from '../state';
import { useCurrentGcode, type CurrentGcode } from './use-current-gcode';

type InspectCurrentGcodeMock = (
  ctx: unknown,
  openInspector: (programName: string, text: string) => void,
  options?: InspectCurrentGcodeOptions,
) => Promise<InspectCurrentGcodeResult>;

const inspectMocks = vi.hoisted(() => ({
  handleInspectCurrentGcode: vi.fn<InspectCurrentGcodeMock>(
    async (_ctx: unknown, openInspector: (programName: string, text: string) => void) => {
      openInspector('untitled (current canvas)', 'G21 G90\nG1 X10 F600\n');
      return { kind: 'ready' as const };
    },
  ),
}));

vi.mock('../app/inspect-current-gcode-action', () => ({
  handleInspectCurrentGcode: inspectMocks.handleInspectCurrentGcode,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookResult = {
  readonly state: CurrentGcode;
  readonly stale: boolean;
  readonly refresh: () => void;
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: HookResult | null = null;

function Probe(props: { readonly active: boolean }): null {
  latest = useCurrentGcode(props.active);
  return null;
}

async function mount(active: boolean): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <PlatformProvider adapter={mockPlatform()}>
        <Probe active={active} />
      </PlatformProvider>,
    );
  });
}

async function rerender(active: boolean): Promise<void> {
  await act(async () => {
    root?.render(
      <PlatformProvider adapter={mockPlatform()}>
        <Probe active={active} />
      </PlatformProvider>,
    );
  });
}

// What a store commit does: a spread replaces the project object identity
// while the view stays open.
async function commitAnEdit(): Promise<void> {
  await act(async () => {
    useStore.setState({ project: { ...useStore.getState().project } });
  });
}

function compileCount(): number {
  return inspectMocks.handleInspectCurrentGcode.mock.calls.length;
}

beforeEach(() => {
  useStore.getState().newProject();
  inspectMocks.handleInspectCurrentGcode.mockReset();
  inspectMocks.handleInspectCurrentGcode.mockImplementation(
    async (_ctx: unknown, openInspector: (programName: string, text: string) => void) => {
      openInspector('untitled (current canvas)', 'G21 G90\nG1 X10 F600\n');
      return { kind: 'ready' as const };
    },
  );
  latest = null;
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.getState().newProject();
});

describe('useCurrentGcode', () => {
  it('compiles once when the view becomes active', async () => {
    await mount(true);
    expect(compileCount()).toBe(1);
    expect(latest?.state.kind).toBe('ready');
    expect(latest?.stale).toBe(false);
  });

  it('does not compile while the view is hidden', async () => {
    await mount(false);
    expect(compileCount()).toBe(0);
    expect(latest?.state.kind).toBe('idle');
  });

  it('does not recompile on every edit — it marks the program stale instead', async () => {
    await mount(true);
    expect(compileCount()).toBe(1);

    await commitAnEdit();
    await commitAnEdit();
    await commitAnEdit();

    expect(compileCount()).toBe(1);
    expect(latest?.stale).toBe(true);
    expect(latest?.state.kind).toBe('ready');
  });

  it('recompiles when the operator asks, clearing stale', async () => {
    await mount(true);
    await commitAnEdit();
    expect(latest?.stale).toBe(true);

    await act(async () => latest?.refresh());

    expect(compileCount()).toBe(2);
    expect(latest?.stale).toBe(false);
  });

  it('recompiles when the view is re-opened after an edit', async () => {
    await mount(true);
    await commitAnEdit();
    await rerender(false);
    expect(compileCount()).toBe(1);

    await rerender(true);

    expect(compileCount()).toBe(2);
    expect(latest?.stale).toBe(false);
  });

  it('cancels stale background compilation when the design changes', async () => {
    let observedSignal: AbortSignal | undefined;
    inspectMocks.handleInspectCurrentGcode.mockImplementation(
      async (
        _ctx: unknown,
        _openInspector: (programName: string, text: string) => void,
        options?: InspectCurrentGcodeOptions,
      ) => {
        observedSignal = options?.signal;
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener('abort', () => resolve()),
        );
        return { kind: 'cancelled' as const };
      },
    );
    await mount(true);
    expect(latest?.state.kind).toBe('compiling');

    await commitAnEdit();

    expect(observedSignal?.aborted).toBe(true);
    expect(latest?.state.kind).toBe('stale');
    expect(latest?.stale).toBe(true);
    expect(compileCount()).toBe(1);
  });

  it('surfaces background compiler progress and unavailable state', async () => {
    let finish:
      | ((value: { readonly kind: 'unavailable'; readonly message: string }) => void)
      | null = null;
    inspectMocks.handleInspectCurrentGcode.mockImplementation(
      async (
        _ctx: unknown,
        _openInspector: (programName: string, text: string) => void,
        options?: InspectCurrentGcodeOptions,
      ) => {
        options?.onProgress?.({
          phase: 'planning',
          mode: 'parallel',
          completed: 2,
          active: 2,
          queued: 3,
          total: 7,
        });
        return await new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    await mount(true);
    expect(latest?.state).toMatchObject({
      kind: 'compiling',
      progress: { phase: 'planning', completed: 2, total: 7 },
    });

    await act(async () =>
      finish?.({ kind: 'unavailable', message: 'Worker capacity unavailable.' }),
    );

    expect(latest?.state).toEqual({
      kind: 'unavailable',
      reason: 'Worker capacity unavailable.',
    });
  });
});
