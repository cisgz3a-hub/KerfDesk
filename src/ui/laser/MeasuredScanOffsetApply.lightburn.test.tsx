import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { captureLayerOperationSettings, createLayer } from '../../core/scene';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { MeasuredScanOffsetApply } from './MeasuredScanOffsetApply';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetStore());

describe('MeasuredScanOffsetApply LightBurn conversion', () => {
  it('converts LightBurn half-gap mm/s input into native persisted values', async () => {
    const view = await renderMeasuredApply();
    try {
      await changeSelect(
        view.host,
        'Scan-offset input convention',
        'lightburn-half-both-directions',
      );
      await changeSelect(view.host, 'Scan-offset speed unit', 'mm-per-second');
      await changeInput(view.host, 'Measured speed 1', '100');
      await changeInput(view.host, 'Measured offset 1', '0.1');

      expect(view.host.textContent).toContain('Speed values entered as mm/s are multiplied by 60');
      expect(view.host.textContent).toContain(
        'LightBurn Initial Offset and .lbso import are not represented',
      );
      expect(view.host.textContent).toContain('+0.2 mm');
      await act(async () => button(view.host, 'Apply measured offsets').click());

      expect(useStore.getState().project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 6000, offsetMm: 0.2 },
      ]);
      expect(useStore.getState().project.device.scanOffsetCalibrationStatus).toBe('pending');
      expect(input(view.host, 'Measured speed 1').value).toBe('100');
      expect(input(view.host, 'Measured offset 1').value).toBe('0.1');
    } finally {
      await view.unmount();
    }
  });

  it('switches display conventions without changing the candidate or dirtying the project', async () => {
    const view = await renderMeasuredApply();
    try {
      await changeInput(view.host, 'Measured speed 1', '3000');
      await changeInput(view.host, 'Measured offset 1', '-0.2');
      expect(view.host.textContent).toContain('-0.2 mm');

      await changeSelect(
        view.host,
        'Scan-offset input convention',
        'lightburn-half-both-directions',
      );
      await changeSelect(view.host, 'Scan-offset speed unit', 'mm-per-second');

      expect(input(view.host, 'Measured speed 1').value).toBe('50');
      expect(input(view.host, 'Measured offset 1').value).toBe('-0.1');
      expect(view.host.textContent).toContain('-0.2 mm');
      expect(useStore.getState().dirty).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it('preserves an exact profile-limit speed through repeated mm/min and mm/s switches', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          maxFeed: 1000,
          scanningOffsets: [{ speedMmPerMin: 1000, offsetMm: 0.12 }],
        },
      },
    }));
    const view = await renderMeasuredApply();
    try {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await changeSelect(view.host, 'Scan-offset speed unit', 'mm-per-second');
        expect(input(view.host, 'Measured speed 1').value).toBe('16.6666666667');
        expect(button(view.host, 'Apply measured offsets').disabled).toBe(false);
        await changeSelect(view.host, 'Scan-offset speed unit', 'mm-per-minute');
        expect(input(view.host, 'Measured speed 1').value).toBe('1000');
      }

      await act(async () => button(view.host, 'Apply measured offsets').click());
      expect(useStore.getState().project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 1000, offsetMm: 0.12 },
      ]);
    } finally {
      await view.unmount();
    }
  });

  it('allows only display-rounding noise at the feed limit and rejects a material overage', async () => {
    useStore.setState((state) => ({
      project: { ...state.project, device: { ...state.project.device, maxFeed: 1000 } },
    }));
    const view = await renderMeasuredApply();
    try {
      await changeSelect(view.host, 'Scan-offset speed unit', 'mm-per-second');
      await changeInput(view.host, 'Measured speed 1', '16.6666666667');
      await changeInput(view.host, 'Measured offset 1', '0.1');
      expect(button(view.host, 'Apply measured offsets').disabled).toBe(false);

      await changeInput(view.host, 'Measured speed 1', '16.6667');
      expect(button(view.host, 'Apply measured offsets').disabled).toBe(true);
      expect(view.host.textContent).toContain('exceeds the profile limit of 1000 mm/min');
    } finally {
      await view.unmount();
    }
  });

  it('shows layer and object overrides including an explicit zero', async () => {
    const layer = {
      ...createLayer({ id: 'fill', name: 'Fill', color: '#ff0000' }),
      mode: 'fill' as const,
      fillStyle: 'scanline' as const,
      fillBidirectional: true,
      bidirectionalScanOffsetMm: 0,
    };
    const object = {
      ...svgObj('logo', ['#ff0000']),
      operationOverride: { bidirectionalScanOffsetMm: -0.08 },
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...state.project.scene, layers: [layer], objects: [object] },
      },
    }));

    const view = await renderMeasuredApply();
    try {
      expect(view.host.textContent).toContain(
        'Saved local scan-offset overrides replace the device table only when the corresponding operation emits bidirectionally',
      );
      expect(view.host.textContent).toContain(
        'Layer Fill: 0 mm (device table disabled when bidirectional)',
      );
      expect(view.host.textContent).toContain('Object logo / operation Fill: -0.08 mm');
    } finally {
      await view.unmount();
    }
  });

  it('shows schema-v5 operation-scoped offsets and distinguishes zero from absence', async () => {
    const parent = createLayer({ id: 'fill', name: 'Base fill', color: '#ff0000' });
    const layer = {
      ...parent,
      mode: 'fill' as const,
      fillStyle: 'scanline' as const,
      fillBidirectional: true,
      subLayers: [
        {
          id: 'finish',
          label: 'Finish fill',
          enabled: true,
          settings: { ...captureLayerOperationSettings(parent), mode: 'fill' as const },
        },
      ],
    };
    const missingLayer = {
      ...createLayer({ id: 'missing', name: 'Missing', color: '#00ff00' }),
      mode: 'fill' as const,
      fillStyle: 'scanline' as const,
      fillBidirectional: true,
    };
    const object = {
      ...svgObj('logo', ['#ff0000']),
      operationIds: ['fill', 'missing'],
      operationOverride: {
        byOperation: {
          fill: { bidirectionalScanOffsetMm: 0 },
          'fill:finish': { bidirectionalScanOffsetMm: 0.09 },
        },
      },
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...state.project.scene, layers: [layer, missingLayer], objects: [object] },
      },
    }));

    const view = await renderMeasuredApply();
    try {
      expect(view.host.textContent).toContain(
        'Object logo / operation Base fill: 0 mm (device table disabled when bidirectional)',
      );
      expect(view.host.textContent).toContain('Object logo / operation Finish fill: +0.09 mm');
      expect(view.host.textContent).not.toContain('Object logo / operation Missing');
    } finally {
      await view.unmount();
    }
  });
});

async function renderMeasuredApply(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<MeasuredScanOffsetApply />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

async function changeInput(host: HTMLElement, label: string, value: string): Promise<void> {
  const field = input(host, label);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

async function changeSelect(host: HTMLElement, label: string, value: string): Promise<void> {
  const field = host.querySelector(`select[aria-label="${label}"]`);
  if (!(field instanceof HTMLSelectElement)) throw new Error(`Select not rendered: ${label}`);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const match = host.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`Input not rendered: ${label}`);
  return match;
}
