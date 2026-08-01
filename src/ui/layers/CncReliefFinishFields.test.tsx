import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefLayerRows } from './CncLayerToolFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LAYER = createLayer({ id: 'relief-layer', color: '#ff0000' });

afterEach(resetStore);

describe('ReliefLayerRows', () => {
  it('keeps a missing finishing bit visible but disabled', async () => {
    useStore.setState({
      project: { ...createProject(), scene: { objects: [], layers: [LAYER] } },
    });
    useStore.getState().setMachineKind('cnc');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <ReliefLayerRows
          layer={LAYER}
          settings={{
            ...DEFAULT_CNC_LAYER_SETTINGS,
            reliefFinishToolId: 'missing-finisher',
          }}
          onCommit={vi.fn()}
          onCommitSettings={vi.fn()}
        />,
      );
    });
    try {
      const select = host.querySelector('select[aria-label="Relief finishing bit for #ff0000"]');
      const unavailable = select?.querySelector('option[value="missing-finisher"]');
      expect(select).toHaveProperty('value', 'missing-finisher');
      expect(unavailable).toBeInstanceOf(HTMLOptionElement);
      expect((unavailable as HTMLOptionElement).disabled).toBe(true);
      expect(unavailable?.textContent).toContain('Current missing finishing bit');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
