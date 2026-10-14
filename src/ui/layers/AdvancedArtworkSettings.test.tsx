import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job/compile-job';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  resetStore();
});

async function render(objects: SceneObject[], layers: Layer[]) {
  useStore.setState((state) => ({
    project: { ...state.project, scene: { objects, layers } },
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<SelectedObjectProperties />));
}

function multiplier(): HTMLInputElement {
  const input = host.querySelector('input[aria-label="Power multiplier for selected objects"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('multiplier missing');
  return input;
}

function result(): string {
  return host.querySelector('[aria-label="Resulting artwork power"]')?.textContent ?? '';
}

const operation = (power = 60): Layer => ({
  ...createLayer({ id: 'L1', color: '#ff0000', name: 'Cut' }),
  power,
});
const artwork = (id = 'O1', powerScale = 100): SceneObject => ({
  ...svgObj(id, ['#ff0000']),
  powerScale,
});

describe('advanced artwork power', () => {
  it('starts collapsed and previews the calculation while editing, then commits and follows operation edits', async () => {
    await render([artwork()], [operation()]);
    const details = multiplier().closest('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Advanced artwork settings');
    expect(result()).toContain('60% × 100% = 60%');
    await act(async () => {
      multiplier().value = '50';
      Simulate.change(multiplier());
    });
    expect(result()).toContain('60% × 50% = 30%');
    await act(async () => Simulate.blur(multiplier()));
    expect(useStore.getState().project.scene.objects[0]?.powerScale).toBe(50);
    await act(async () => useStore.getState().setLayerParam('L1', { power: 80 }));
    expect(result()).toContain('80% × 50% = 40%');
  });

  it('matches compiled powers for multiple operations, enabled sublayers and artwork overrides', async () => {
    const first = operation();
    const layer = {
      ...first,
      subLayers: [
        createLayerSubLayer(first, {
          id: 'finish',
          label: 'Finish',
          settings: { ...captureLayerOperationSettings(first), power: 20 },
        }),
        createLayerSubLayer(first, { id: 'disabled', label: 'Disabled', enabled: false }),
      ],
    };
    const second = { ...operation(80), id: 'L2', name: 'Second' };
    const objects = [
      {
        ...artwork('O1', 50),
        operationOverride: {
          ...captureLayerOperationSettings(first),
          power: 40,
          byOperation: { L2: { power: 30 } },
        },
      },
    ];
    await render(objects, [layer, second]);
    const job = compileJob(useStore.getState().project.scene, DEFAULT_DEVICE_PROFILE);
    expect(job.groups.map((group) => (group.kind === 'cnc' ? null : group.power))).toEqual([
      20, 20, 15,
    ]);
    expect(result()).toContain('Cut: 40% × 50% = 20%');
    expect(result()).toContain('Finish: 40% × 50% = 20%');
    expect(result()).toContain('Second: 30% × 50% = 15%');
    expect(result()).not.toContain('Disabled');
  });

  it('keeps mixed multipliers intact on blur and shows each artwork result', async () => {
    await render([artwork('O1', 50), artwork('O2', 100)], [operation()]);
    expect(multiplier().placeholder).toBe('Mixed');
    expect(multiplier().value).toBe('');
    expect(result()).toContain('60% × 50% = 30%');
    expect(result()).toContain('60% × 100% = 60%');
    await act(async () => Simulate.blur(multiplier()));
    expect(useStore.getState().project.scene.objects.map((object) => object.powerScale)).toEqual([
      50, 100,
    ]);
  });

  it('keeps the saved power when the multiplier draft is cleared and then accepts retyping', async () => {
    await render([artwork('O1', 50)], [operation()]);
    await act(async () => {
      multiplier().value = '';
      Simulate.change(multiplier());
    });
    expect(result()).toContain('60% × 50% = 30%');
    await act(async () => Simulate.blur(multiplier()));
    expect(useStore.getState().project.scene.objects[0]?.powerScale).toBe(50);
    await act(async () => {
      multiplier().value = '75';
      Simulate.change(multiplier());
    });
    expect(result()).toContain('60% × 75% = 45%');
    await act(async () => Simulate.blur(multiplier()));
    expect(useStore.getState().project.scene.objects[0]?.powerScale).toBe(75);
  });

  it('shows separate minimum and maximum for image operations', async () => {
    const vector = svgObj('R1', ['#ff0000']);
    await render(
      [
        {
          kind: 'raster-image',
          id: 'R1',
          source: 'photo.png',
          color: '#ff0000',
          bounds: vector.bounds,
          transform: vector.transform,
          powerScale: 50,
          pixelWidth: 1,
          pixelHeight: 1,
          dataUrl: '',
          lumaBase64: 'AA==',
          dither: 'grayscale',
          linesPerMm: 1,
        },
      ],
      [{ ...operation(), mode: 'image', minPower: 10, ditherAlgorithm: 'grayscale' }],
    );
    expect(result()).toContain('60% × 50% = 30% maximum; 5% grayscale minimum');
    await act(async () =>
      useStore.getState().setLayerParam('L1', { ditherAlgorithm: 'threshold' }),
    );
    expect(result()).toContain('60% × 50% = 30% maximum');
    expect(result()).not.toContain('minimum');
    await act(async () => useStore.getState().setLayerParam('L1', { passThrough: true }));
    expect(result()).toContain('60% × 50% = 30% maximum; 5% grayscale minimum');
  });

  it('does not imply output for a disabled operation or incompatible artwork', async () => {
    await render([artwork()], [{ ...operation(), output: false }]);
    expect(result()).toContain('No enabled laser operation');
    await act(async () => useStore.getState().setLayerParam('L1', { output: true, mode: 'image' }));
    expect(result()).toContain('No enabled laser operation');
    await act(async () => useStore.getState().setMachineKind('cnc'));
    expect(host.textContent).not.toContain('Advanced artwork settings');
  });
});
