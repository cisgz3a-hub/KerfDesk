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

function installCnc(): void {
  useStore.setState({
    project: { ...createProject(), scene: { objects: [], layers: [LAYER] } },
  });
  useStore.getState().setMachineKind('cnc');
  useUiStore.getState().setShowCncAdvanced(false);
}

async function renderFields(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<CncLayerFields layer={LAYER} />));
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

  it('labels the revealed advanced group inside the layer card', async () => {
    installCnc();
    const view = await renderFields();
    try {
      expect(view.host.querySelector('section[aria-label="Advanced cut settings"]')).toBeNull();
      await act(async () => useUiStore.getState().setShowCncAdvanced(true));
      const section = view.host.querySelector('section[aria-label="Advanced cut settings"]');
      expect(section?.textContent).toContain('Advanced');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });
});
