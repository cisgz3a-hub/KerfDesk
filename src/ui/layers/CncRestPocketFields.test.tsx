import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { RestPocketToolSelect } from './CncRestPocketFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LAYER: Layer = createLayer({ id: 'rest-pocket-layer', color: '#1166aa' });

afterEach(resetStore);

function installCnc(): void {
  useStore.setState({ project: { ...createProject(), scene: { objects: [], layers: [LAYER] } } });
  useStore.getState().setMachineKind('cnc');
}

async function render(
  settings: CncLayerSettings,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <RestPocketToolSelect layer={LAYER} settings={settings} onCommitSettings={vi.fn()} />,
    );
  });
  return { host, root };
}

describe('RestPocketToolSelect', () => {
  it('groups eligible roughers and renders geometry-first labels', async () => {
    installCnc();
    const { host, root } = await render({
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket',
      toolId: 'em-1588',
    });
    try {
      const select = host.querySelector('select');
      expect(select?.querySelector('optgroup[label="Square / straight end mills"]')).not.toBeNull();
      expect(select?.querySelector('optgroup[label="Downcut spiral end mills"]')).not.toBeNull();
      expect(select?.querySelector('option[value="em-3175"]')?.textContent).toBe(
        '3.175 mm, End mill — 3.175 mm (1/8") end mill',
      );
      expect(select?.querySelector('option[value="bn-3175"]')).toBeNull();
      expect(select?.querySelector('option[value="vb-90"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps a persisted invalid rougher visible but disabled', async () => {
    installCnc();
    const { host, root } = await render({
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket',
      toolId: 'em-1588',
      pocketRoughToolId: 'bn-3175',
    });
    try {
      const select = host.querySelector('select');
      const invalid = select?.querySelector('option[value="bn-3175"]');
      expect(select).toHaveProperty('value', 'bn-3175');
      expect(invalid).toBeInstanceOf(HTMLOptionElement);
      expect((invalid as HTMLOptionElement).disabled).toBe(true);
      expect(invalid?.textContent).toContain('choose a larger flat end mill');
      expect(invalid?.textContent).toContain('3.175 mm, Ball nose');
      expect(select?.querySelector('option[value="bn-1588"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
