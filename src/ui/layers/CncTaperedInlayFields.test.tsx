import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        objects: [],
        layers: [
          {
            ...createLayer({ id: 'inlay', color: '#000000' }),
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              cutType: 'inlay-pair',
              feedMmPerMin: 731,
              inlayPocketDepthMm: 2.7,
              depthMm: 8,
            },
          },
        ],
      },
    },
  });
  await act(async () => root.render(<ConnectedFields />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});
function ConnectedFields(): JSX.Element {
  const layer = useStore((state) => state.project.scene.layers[0]);
  if (layer === undefined) throw new Error('Missing layer');
  return <CncLayerFields layer={layer} />;
}
async function choose(value: string): Promise<void> {
  const select = host.querySelector<HTMLSelectElement>(
    'select[aria-label="Inlay pair method for #000000"]',
  );
  if (select === null) throw new Error('Missing pair method');
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function change(label: string, value: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label} for #000000"]`);
  if (input === null) throw new Error(`Missing ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('canonical linked tapered inlay editor', () => {
  it('keeps straight records intact and makes tapered depth meanings and pair linkage explicit', async () => {
    expect(host.querySelector('input[aria-label="Insert depth for #000000"]')).not.toBeNull();
    await choose('tapered-v');
    expect(host.textContent).toContain('Pocket depth = engagement + glue gap');
    expect(host.textContent).toContain('intentionally retains the pair linkage');
    expect(host.querySelector('input[aria-label="Insert depth for #000000"]')).toBeNull();
    expect(host.textContent).not.toContain('Tab height');
    expect(useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin).toBe(731);
    await choose('straight');
    const settings = useStore.getState().project.scene.layers[0]?.cnc;
    expect(settings?.taperedInlay).toBeUndefined();
    expect(settings?.inlayPocketDepthMm).toBe(2.7);
    expect(settings?.depthMm).toBe(8);
  });

  it('updates linked axial dimensions without changing the radial gap', async () => {
    await choose('tapered-v');
    await change('Glue gap', '0.9');
    const intent = useStore.getState().project.scene.layers[0]?.cnc?.taperedInlay;
    expect(intent?.pocketDepthMm).toBe(3.4);
    expect(intent?.engagementDepthMm).toBe(2.5);
    expect(intent?.fitClearanceMm).toBe(0.05);
    expect(intent?.surfaceClearanceMm).toBe(1);
  });
});
