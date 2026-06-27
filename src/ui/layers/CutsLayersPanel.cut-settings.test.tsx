import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { CutsLayersPanel } from './CutsLayersPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: {
    isSupported: () => false,
    requestPort: async () => null,
  },
};

function PanelUnderTest(): JSX.Element {
  return (
    <PlatformProvider adapter={mockPlatform}>
      <CutsLayersPanel />
    </PlatformProvider>
  );
}

async function renderPanel(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<PanelUnderTest />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  resetStore();
});

describe('CutsLayersPanel cut settings editor', () => {
  it('opens a staged editor and applies changes only after OK', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const { host, unmount } = await renderPanel();
    try {
      await openCutSettings(host, '#ff0000');
      const power = requireInput(host, 'input[aria-label="Cut settings power"]');
      const speed = requireInput(host, 'input[aria-label="Cut settings speed"]');

      await act(async () => {
        power.value = '42';
        power.dispatchEvent(new Event('input', { bubbles: true }));
        speed.value = '1777';
        speed.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(useStore.getState().project.scene.layers[0]?.power).toBe(30);

      await clickButtonWithText(host, 'OK');

      const layer = useStore.getState().project.scene.layers[0];
      expect(layer?.power).toBe(42);
      expect(layer?.speed).toBe(1777);
    } finally {
      await unmount();
    }
  });

  it('cancels staged cut setting edits without mutating the layer', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const { host, unmount } = await renderPanel();
    try {
      await openCutSettings(host, '#ff0000');
      const speed = requireInput(host, 'input[aria-label="Cut settings speed"]');
      await act(async () => {
        speed.value = '999';
        speed.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await clickButtonWithText(host, 'Cancel');

      expect(useStore.getState().project.scene.layers[0]?.speed).toBe(1500);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await unmount();
    }
  });

  it('makes a layer default from the Cut Settings dialog', async () => {
    useStore.getState().createManualLayer('#ff0000');
    useStore.getState().setLayerParam('#ff0000', { mode: 'fill', power: 24, speed: 1888 });
    const { host, unmount } = await renderPanel();
    try {
      await openCutSettings(host, '#ff0000');
      await clickButtonWithText(host, 'Make Default');

      await act(async () => {
        useStore.getState().deleteLayerAndObjects('#ff0000');
        useStore.getState().createManualLayer('#ff0000');
      });

      expect(useStore.getState().project.scene.layers[0]).toMatchObject({
        id: '#ff0000',
        color: '#ff0000',
        mode: 'fill',
        power: 24,
        speed: 1888,
      });
    } finally {
      await unmount();
    }
  });

  it('applies image toggles from the staged image editor', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', { mode: 'image' });
    const { host, unmount } = await renderPanel();
    try {
      await openCutSettings(host, '#ff0000');
      requireInput(host, 'input[name="negativeImage"]').checked = true;
      requireInput(host, 'input[name="passThrough"]').checked = true;
      requireInput(host, 'input[name="imageBidirectional"]').checked = false;
      requireInput(host, 'input[name="dotWidthCorrectionMm"]').value = '0.08';

      await clickButtonWithText(host, 'OK');

      const layer = useStore.getState().project.scene.layers[0];
      expect((layer as { readonly negativeImage?: boolean })?.negativeImage).toBe(true);
      expect((layer as { readonly passThrough?: boolean })?.passThrough).toBe(true);
      expect((layer as { readonly imageBidirectional?: boolean })?.imageBidirectional).toBe(false);
      expect((layer as { readonly dotWidthCorrectionMm?: number })?.dotWidthCorrectionMm).toBe(
        0.08,
      );
    } finally {
      await unmount();
    }
  });

  it('maps staged cut-settings DPI into image lines per mm', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', { mode: 'image' });
    const { host, unmount } = await renderPanel();
    try {
      await openCutSettings(host, '#ff0000');
      const dpiInput = requireInput(host, 'input[name="imageDpi"]');
      dpiInput.value = '508';
      expect(dpiInput.validity.stepMismatch).toBe(false);
      expect(dpiInput.checkValidity()).toBe(true);

      await clickButtonWithText(host, 'OK');

      expect(useStore.getState().project.scene.layers[0]?.linesPerMm).toBe(20);
    } finally {
      await unmount();
    }
  });

  it('applies image toggles from the selected artwork settings to the selected object only', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', { mode: 'image' });
    const { host, unmount } = await renderPanel();
    try {
      const negative = requireInput(
        host,
        'input[aria-label="Negative image for selected objects"]',
      );
      const passThrough = requireInput(
        host,
        'input[aria-label="Pass-through image for selected objects"]',
      );
      const bidirectional = requireInput(
        host,
        'input[aria-label="Bidirectional image scan for selected objects"]',
      );
      const dotWidth = requireInput(
        host,
        'input[aria-label="Dot width correction for selected objects"]',
      );

      await act(async () => {
        negative.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        passThrough.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        bidirectional.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        dotWidth.value = '0.07';
        Simulate.change(dotWidth);
      });
      await act(async () => {
        Simulate.blur(dotWidth);
      });

      const state = useStore.getState();
      const layer = state.project.scene.layers[0];
      const override = state.project.scene.objects[0]?.operationOverride;
      expect((layer as { readonly negativeImage?: boolean })?.negativeImage).toBe(false);
      expect((layer as { readonly passThrough?: boolean })?.passThrough).toBe(false);
      expect((layer as { readonly imageBidirectional?: boolean })?.imageBidirectional).toBe(true);
      expect((layer as { readonly dotWidthCorrectionMm?: number })?.dotWidthCorrectionMm).toBe(0);
      expect(override?.negativeImage).toBe(true);
      expect(override?.passThrough).toBe(true);
      expect(override?.imageBidirectional).toBe(false);
      expect(override?.dotWidthCorrectionMm).toBe(0.07);
    } finally {
      await unmount();
    }
  });

  it('maps selected artwork line interval and DPI edits onto the selected object only', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().setLayerParam('#ff0000', { mode: 'image' });
    const { host, unmount } = await renderPanel();
    try {
      const interval = requireInput(host, 'input[aria-label="Line interval for selected objects"]');
      await act(async () => {
        interval.value = '0.2';
        Simulate.change(interval);
      });
      await act(async () => {
        Simulate.blur(interval);
      });
      let state = useStore.getState();
      expect(state.project.scene.layers[0]?.linesPerMm).toBe(10);
      expect(state.project.scene.objects[0]?.operationOverride?.linesPerMm).toBe(5);

      const dpi = requireInput(host, 'input[aria-label="DPI for selected objects"]');
      await act(async () => {
        dpi.value = '254';
        Simulate.change(dpi);
      });
      expect(dpi.validity.stepMismatch).toBe(false);
      expect(dpi.checkValidity()).toBe(true);
      await act(async () => {
        Simulate.blur(dpi);
      });
      state = useStore.getState();
      expect(state.project.scene.layers[0]?.linesPerMm).toBe(10);
      expect(state.project.scene.objects[0]?.operationOverride?.linesPerMm).toBe(10);
    } finally {
      await unmount();
    }
  });
});

async function openCutSettings(host: HTMLElement, color: string): Promise<void> {
  const edit = host.querySelector(`button[aria-label="Edit cut settings for ${color}"]`);
  if (!(edit instanceof HTMLButtonElement)) throw new Error('edit button missing');
  await act(async () => {
    edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function clickButtonWithText(host: HTMLElement, text: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button missing`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function requireInput(host: HTMLElement, selector: string): HTMLInputElement {
  const input = host.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${selector} missing`);
  return input;
}
