import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useCameraPlacementControls } from './use-camera-placement-controls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useStore.getState().newProject();
  useCameraStore.setState({
    overlayVisible: false,
    overlayStill: null,
    placementActive: false,
    confirmedPositionEpoch: null,
  });
});

describe('useCameraPlacementControls', () => {
  it('activates camera placement without rewriting the selected origin mode', async () => {
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'center' } });
    useCameraStore.setState({ overlayVisible: false, placementActive: false });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;

    function Harness(): JSX.Element {
      const placement = useCameraPlacementControls(true);
      return (
        <button type="button" onClick={placement.toggleOverlay}>
          Toggle overlay
        </button>
      );
    }

    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<Harness />);
      });
      const button = host.querySelector('button');
      if (button === null) throw new Error('Toggle button not rendered');

      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(useCameraStore.getState().placementActive).toBe(true);
      expect(useStore.getState().jobPlacement.startFrom).toBe('user-origin');
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
