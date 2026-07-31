import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncProjectMaterialPicker } from './CncProjectMaterialPicker';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(resetStore);

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<CncProjectMaterialPicker activeMaterialKey={undefined} />);
  });
  return { host, root };
}

describe('CncProjectMaterialPicker angled-tool disclosure', () => {
  it('shows the exact V-bit caveat while keeping project Apply available', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().createManualLayer('#aa0000');
    const layer = useStore.getState().project.scene.layers[0];
    if (layer === undefined) throw new Error('layer missing');
    useStore.getState().setLayerParam(layer.id, {
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'vb-90' },
    });
    const { host, root } = await render();
    try {
      const select = host.querySelector('select[aria-label="Project material"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('material select missing');
      select.value = 'hardwood-walnut';
      await act(async () => Simulate.change(select));

      expect(host.textContent).toContain(
        'V-bit rough guide: the material recipe uses the stored 12.7 mm diameter band.',
      );
      expect(host.textContent).toContain(
        'It does not model the 90° included angle or the cutting width at each depth.',
      );
      expect(host.textContent).toContain("Start with the cutter manufacturer's data");
      const apply = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Apply Walnut preset'),
      );
      expect(apply).toBeInstanceOf(HTMLButtonElement);
      expect((apply as HTMLButtonElement).disabled).toBe(false);
      await act(async () => Simulate.click(apply as HTMLButtonElement));
      const machine = useStore.getState().project.machine;
      expect(machine?.kind === 'cnc' ? machine.stock.materialKey : undefined).toBe(
        'hardwood-walnut',
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
