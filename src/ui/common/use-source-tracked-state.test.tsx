import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useSourceTrackedState } from './use-source-tracked-state';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  const current = root;
  if (current !== null) await act(async () => current.unmount());
  host?.remove();
  root = null;
  host = null;
});

type Harness = {
  readonly render: (source: number, contextKey: string) => Promise<void>;
  readonly value: () => number;
  readonly set: (next: number) => Promise<void>;
};

async function mount(source: number, contextKey: string): Promise<Harness> {
  let latestValue = source;
  let latestSet: (next: number) => void = (next) => {
    throw new Error(`setter used before first render (${next})`);
  };
  function Probe(probeProps: {
    readonly source: number;
    readonly contextKey: string;
  }): JSX.Element {
    const [value, set] = useSourceTrackedState(probeProps.source, probeProps.contextKey);
    latestValue = value;
    latestSet = set;
    return <span>{value}</span>;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  const created = createRoot(host);
  root = created;
  const render = async (nextSource: number, nextKey: string): Promise<void> => {
    await act(async () => created.render(<Probe source={nextSource} contextKey={nextKey} />));
  };
  await render(source, contextKey);
  return {
    render,
    value: () => latestValue,
    set: async (next: number) => {
      await act(async () => latestSet(next));
    },
  };
}

describe('useSourceTrackedState', () => {
  it('follows the source until the caller overrides it', async () => {
    const harness = await mount(300, 'stock:300x300');
    expect(harness.value()).toBe(300);
    await harness.set(120);
    expect(harness.value()).toBe(120);
  });

  it('keeps the override while the context is unchanged, even as the tree re-renders', async () => {
    const harness = await mount(300, 'stock:300x300');
    await harness.set(120);
    await harness.render(300, 'stock:300x300');
    expect(harness.value()).toBe(120);
  });

  it('drops the override and re-prefills when the source identity changes', async () => {
    const harness = await mount(300, 'stock:300x300');
    await harness.set(120);
    // A different project / stock / bit: the stale 120 must not survive.
    await harness.render(600, 'stock:600x400');
    expect(harness.value()).toBe(600);
  });

  it('follows later source movement once re-prefilled', async () => {
    const harness = await mount(300, 'stock:300x300');
    await harness.set(120);
    await harness.render(600, 'stock:600x400');
    await harness.render(800, 'stock:800x400');
    expect(harness.value()).toBe(800);
  });
});
