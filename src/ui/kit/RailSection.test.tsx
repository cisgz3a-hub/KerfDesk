import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { RailSection } from './RailSection';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(node: JSX.Element): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(node);
  });
  return host;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('RailSection', () => {
  it('renders the shared disclosure chrome, hover help, badge, and body', async () => {
    const h = await render(
      <RailSection label="Probe" hint="Configure the touch probe" badge="Ready" open>
        <button type="button">Run probe</button>
      </RailSection>,
    );

    const details = h.querySelector('details');
    expect(details?.className).toBe('lf-section');
    expect(details?.open).toBe(true);

    const summary = details?.querySelector('summary');
    expect(summary?.title).toBe('Configure the touch probe');
    expect(summary?.textContent).toBe('ProbeReady');
    expect(summary?.querySelector('.lf-section-badge')?.textContent).toBe('Ready');
    expect(details?.querySelector('.lf-section-body button')?.textContent).toBe('Run probe');
  });

  it('is closed by default for uncontrolled disclosure behavior', async () => {
    const h = await render(
      <RailSection label="Tiling" hint="Split a large job across tiles">
        Tile controls
      </RailSection>,
    );

    expect(h.querySelector('details')?.open).toBe(false);
  });
});
