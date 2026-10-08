import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncMachineConfig,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  toolId: 'finish',
  tools: [
    { id: 'rough', name: '8 mm rough cutter', kind: 'end-mill', diameterMm: 8 },
    { id: 'finish', name: '2 mm finish cutter', kind: 'end-mill', diameterMm: 2 },
  ],
};
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useStore.setState({
    project: {
      ...createProject(),
      machine: MACHINE,
      scene: {
        objects: [],
        layers: [
          {
            ...createLayer({ id: 'rest', color: '#000000' }),
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              cutType: 'pocket',
              pocketRoughToolId: 'rough',
              toolId: 'finish',
              feedMmPerMin: 731,
              depthMm: 2,
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
  if (layer === undefined) throw new Error('Missing rest layer');
  return <CncLayerFields layer={layer} />;
}
async function toggle(): Promise<void> {
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Use planned-route stock for #000000"]',
  );
  if (input === null) throw new Error('Missing planned stock control');
  await act(async () => input.click());
}

describe('canonical previous-stock editor', () => {
  it('explicitly binds selected rough-stage routes and preserves legacy values on removal', async () => {
    expect(host.textContent).toContain('Legacy reach model');
    await toggle();
    expect(useStore.getState().project.scene.layers[0]?.cnc?.pocketRestStock).toEqual({
      kind: 'rough-stage-stock',
      previousToolId: 'rough',
      previousToolDiameterMm: 8,
      toleranceMm: 0.01,
    });
    expect(host.textContent).toContain('Actual stock');
    expect(host.textContent).toContain('full offset-pocket fallback');
    await toggle();
    const settings = useStore.getState().project.scene.layers[0]?.cnc;
    expect(settings?.pocketRestStock).toBeUndefined();
    expect(settings?.pocketRoughToolId).toBe('rough');
    expect(settings?.depthMm).toBe(2);
    expect(settings?.feedMmPerMin).toBe(731);
  });

  it('discloses a changed cutter and requires an explicit rebind of its diameter snapshot', async () => {
    await toggle();
    await act(async () =>
      useStore.setState((state) => ({
        project: {
          ...state.project,
          machine: {
            ...MACHINE,
            tools: MACHINE.tools.map((tool) =>
              tool.id === 'rough' ? { ...tool, diameterMm: 7 } : tool,
            ),
          },
        },
      })),
    );
    expect(host.textContent).toContain('The source cutter changed');
    expect(host.textContent).toContain('full finishing pocket');
    expect(
      useStore.getState().project.scene.layers[0]?.cnc?.pocketRestStock?.previousToolDiameterMm,
    ).toBe(8);
    const button = Array.from(host.querySelectorAll('button')).find(
      (element) => element.textContent === 'Review and bind current roughing cutter',
    );
    if (button === undefined) throw new Error('Missing rebind control');
    await act(async () => button.click());
    expect(
      useStore.getState().project.scene.layers[0]?.cnc?.pocketRestStock?.previousToolDiameterMm,
    ).toBe(7);
    expect(host.textContent).not.toContain('The source cutter changed');
  });
});
