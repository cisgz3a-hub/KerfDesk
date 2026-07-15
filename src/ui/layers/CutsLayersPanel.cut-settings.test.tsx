import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { primaryOperationForObject } from '../../core/scene';
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
  serial: { isSupported: () => false, requestPort: async () => null },
};

afterEach(() => resetStore());

describe('selected artwork cut settings', () => {
  it('updates job air assist on the selected artwork operation', async () => {
    arrangeArtwork();
    const panel = await renderPanel();
    try {
      const air = requireInput(panel.host, 'input[aria-label="Air assist for selected operation"]');
      expect(air.checked).toBe(false);

      await act(async () => air.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(operation().airAssist).toBe(true);
    } finally {
      await panel.unmount();
    }
  });

  it('shows CNC fields instead of laser air assist in CNC mode', async () => {
    useStore.getState().setMachineKind('cnc');
    arrangeArtwork();
    const panel = await renderPanel();
    try {
      expect(
        panel.host.querySelector('input[aria-label="Air assist for selected operation"]'),
      ).toBeNull();
      expect(panel.host.textContent).toContain('Cut depth');
    } finally {
      await panel.unmount();
    }
  });

  it('stages advanced settings and applies them only after OK', async () => {
    arrangeArtwork();
    const panel = await renderPanel();
    try {
      await openAdvancedSettings(panel.host);
      const power = requireInput(panel.host, 'input[aria-label="Cut settings power"]');
      const speed = requireInput(panel.host, 'input[aria-label="Cut settings speed"]');
      await act(async () => {
        power.value = '42';
        power.dispatchEvent(new Event('input', { bubbles: true }));
        speed.value = '1777';
        speed.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(operation().power).toBe(30);

      await clickButton(panel.host, 'OK');

      expect(operation()).toMatchObject({ power: 42, speed: 1777 });
    } finally {
      await panel.unmount();
    }
  });

  it('caps advanced speed to the active device maximum', async () => {
    arrangeArtwork();
    useStore.setState((state) => ({
      project: { ...state.project, device: { ...state.project.device, maxFeed: 1200 } },
    }));
    const panel = await renderPanel();
    try {
      await openAdvancedSettings(panel.host);
      const speed = requireInput(panel.host, 'input[aria-label="Cut settings speed"]');
      expect(speed.max).toBe('1200');
      expect(speed.value).toBe('1200');
      await clickButton(panel.host, 'OK');
      expect(operation().speed).toBe(1200);
    } finally {
      await panel.unmount();
    }
  });

  it('cancels staged settings without changing the operation', async () => {
    arrangeArtwork();
    const panel = await renderPanel();
    try {
      await openAdvancedSettings(panel.host);
      const speed = requireInput(panel.host, 'input[aria-label="Cut settings speed"]');
      await act(async () => {
        speed.value = '999';
        speed.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await clickButton(panel.host, 'Cancel');
      expect(operation().speed).toBe(1500);
      expect(panel.host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await panel.unmount();
    }
  });

  it('edits image settings directly on the selected artwork operation', async () => {
    arrangeArtwork();
    useStore.getState().setLayerParam(operation().id, { mode: 'image' });
    const panel = await renderPanel();
    try {
      const negative = requireInput(
        panel.host,
        'input[aria-label="Negative image for selected objects"]',
      );
      const interval = requireInput(
        panel.host,
        'input[aria-label="Line interval for selected objects"]',
      );
      await act(async () => negative.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => {
        interval.value = '0.2';
        Simulate.change(interval);
      });
      await act(async () => Simulate.blur(interval));

      expect(operation()).toMatchObject({ negativeImage: true, linesPerMm: 5 });
      expect(useStore.getState().project.scene.objects[0]?.operationOverride).toBeUndefined();
    } finally {
      await panel.unmount();
    }
  });

  it('applies fill style from the advanced operation dialog', async () => {
    arrangeArtwork();
    useStore.getState().setLayerParam(operation().id, { mode: 'fill', fillStyle: 'scanline' });
    const panel = await renderPanel();
    try {
      await openAdvancedSettings(panel.host);
      const fillStyle = requireSelect(panel.host, 'select[name="fillStyle"]');
      fillStyle.value = 'offset';
      await clickButton(panel.host, 'OK');
      expect(operation().fillStyle).toBe('offset');
    } finally {
      await panel.unmount();
    }
  });
});

function arrangeArtwork(): void {
  useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
}

function operation() {
  const scene = useStore.getState().project.scene;
  const object = scene.objects.find((candidate) => candidate.id === 'O1');
  const selected = object === undefined ? null : primaryOperationForObject(object, scene.layers);
  if (selected === null) throw new Error('selected operation missing');
  return selected;
}

function PanelUnderTest(): JSX.Element {
  return (
    <PlatformProvider adapter={mockPlatform}>
      <CutsLayersPanel />
    </PlatformProvider>
  );
}

async function renderPanel(): Promise<{ host: HTMLDivElement; unmount: () => Promise<void> }> {
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

async function openAdvancedSettings(host: HTMLElement): Promise<void> {
  await clickButton(host, 'Advanced cut settings');
}

async function clickButton(host: HTMLElement, text: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button missing`);
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function requireInput(host: HTMLElement, selector: string): HTMLInputElement {
  const input = host.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${selector} missing`);
  return input;
}

function requireSelect(host: HTMLElement, selector: string): HTMLSelectElement {
  const select = host.querySelector(selector);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`${selector} missing`);
  return select;
}
