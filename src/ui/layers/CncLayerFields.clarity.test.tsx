import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LAYER: Layer = {
  ...createLayer({ id: 'L1', color: '#000000' }),
  cnc: DEFAULT_CNC_LAYER_SETTINGS,
};

afterEach(() => {
  resetStore();
  useUiStore.getState().setShowCncAdvanced(false);
});

function installCnc(layer: Layer = LAYER): void {
  useStore.setState({
    project: { ...createProject(), scene: { objects: [], layers: [layer] } },
  });
  useStore.getState().setMachineKind('cnc');
  useUiStore.getState().setShowCncAdvanced(false);
}

async function renderFields(
  layer: Layer = LAYER,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<CncLayerFields layer={layer} />));
  return { host, root };
}

describe('CNC layer clarity', () => {
  it('leads with material and warns when manual values are active', async () => {
    installCnc();
    const view = await renderFields();
    try {
      const selectLabels = [...view.host.querySelectorAll('select')].map((select) =>
        select.getAttribute('aria-label'),
      );
      expect(selectLabels.slice(0, 4)).toEqual([
        'Material for #000000',
        'Cut type for #000000',
        // ADR-218: the line-art side qualifies the cut type, so it sits
        // directly under it (default cut type is profile-outside → shown).
        'Line art contours for #000000',
        'Bit for #000000',
      ]);
      expect(view.host.textContent).toContain('Manual values are active');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('reveals V-carve Detail directly below the clicked Advanced control', async () => {
    const layer: Layer = {
      ...LAYER,
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
    };
    installCnc(layer);
    const view = await renderFields(layer);
    try {
      const toggle = view.host.querySelector('input[aria-label="Show advanced cut settings"]');
      if (!(toggle instanceof HTMLInputElement)) throw new Error('advanced toggle missing');
      expect(view.host.querySelector('section[aria-label="Advanced cut settings"]')).toBeNull();
      expect(view.host.querySelector(`input[aria-label="Detail for ${layer.color}"]`)).toBeNull();

      await act(async () => toggle.click());

      const section = view.host.querySelector('section[aria-label="Advanced cut settings"]');
      expect(section?.textContent).toContain('Advanced');
      expect(
        view.host.querySelector(`input[aria-label="Detail for ${layer.color}"]`),
      ).not.toBeNull();
      expect(toggle.closest('label')?.nextElementSibling).toBe(section);
      expect(toggle.getAttribute('aria-label')).toBe('Hide advanced cut settings');
      expect(view.host.textContent).toContain('Hide advanced cut settings');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });
});
