import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useCurrentGcode, type CurrentGcode } from './use-current-gcode';

const inspectMocks = vi.hoisted(() => ({
  handleInspectCurrentGcode: vi.fn(
    async (_ctx: unknown, openInspector: (programName: string, text: string) => void) => {
      openInspector('untitled (current canvas)', 'G21 G90\nG1 X10 F600\n');
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
  inspectMocks.handleInspectCurrentGcode.mockClear();
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
});
