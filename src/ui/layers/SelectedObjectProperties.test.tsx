import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

// React reads this test-only global to decide whether state updates must be wrapped in act().
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  resetStore();
});

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<SelectedObjectProperties />);
  });
  return { host, root };
}

async function cleanup(root: Root, host: HTMLDivElement): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
}

async function change(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    Simulate.change(select);
  });
}

function rectangle(id: string) {
  return createRectangle({
    id,
    color: '#ff0000',
    spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 },
  });
}

function raster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 20,
    pixelHeight: 20,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

const TARGET_SWITCH_CASES = [
  ['power-scale', '40', 'Power scale for inspected artwork'],
  ['operation', '17', 'Power for inspected artwork'],
  ['shape', '75', 'Rectangle width'],
  ['image', '30', 'Brightness for I1.png'],
  ['primary-image', '45', 'Brightness for I1.png'],
] as const;

type TargetSwitchKind = (typeof TARGET_SWITCH_CASES)[number][0];

function seedTargetSwitch(kind: TargetSwitchKind): void {
  for (const id of kind === 'power-scale' ? ['O1', 'O2'] : kind === 'operation' ? ['O1'] : []) {
    useStore.getState().importSvgObject(svgObj(id, ['#000000']));
  }
  if (kind === 'operation') useStore.getState().addOperationForObjects(['O1']);
  if (kind === 'shape') {
    useStore.getState().drawShape(rectangle('S1'));
    useStore.getState().drawShape(rectangle('S2'));
  }
  if (kind === 'image' || kind === 'primary-image') {
    useStore.getState().importRasterImage(raster('I1'));
    useStore.getState().importRasterImage(raster('I2'));
  }
  if (kind === 'primary-image') {
    useStore.setState({ selectedObjectId: 'I1', additionalSelectedIds: new Set(['I2']) });
  } else {
    useStore.getState().selectObject(null);
  }
}

async function switchTarget(kind: TargetSwitchKind, host: HTMLDivElement): Promise<void> {
  if (kind === 'primary-image') {
    await act(async () => {
      useStore.setState({ selectedObjectId: 'I2', additionalSelectedIds: new Set(['I1']) });
    });
    return;
  }
  const chooserLabel = kind === 'operation' ? 'Operation to inspect' : 'Artwork to inspect';
  const chooser = host.querySelector(`select[aria-label="${chooserLabel}"]`);
  if (!(chooser instanceof HTMLSelectElement)) throw new Error(`${chooserLabel} missing`);
  const targets = { 'power-scale': 'O2', shape: 'S2', image: 'I2' } as const;
  const target = kind === 'operation' ? chooser.options[1]?.value : targets[kind];
  if (target === undefined) throw new Error('switch target missing');
  await choose(chooser, target);
}

describe('SelectedObjectProperties', () => {
  it('does not render when the canvas has no artwork', async () => {
    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Selected object properties"]')).toBeNull();
    } finally {
      await cleanup(root, host);
    }
  });

  it('keeps one artwork editable after it is deselected on the canvas', async () => {
    useStore.getState().drawShape(rectangle('rect-1'));
    useStore.getState().selectObject(null);
    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Artwork properties"]')).not.toBeNull();
      expect(host.textContent).toContain('Nothing selected on canvas');
      const radius = host.querySelector('input[aria-label="Rectangle corner radius"]');
      if (!(radius instanceof HTMLInputElement)) throw new Error('corner radius input missing');
      await change(radius, '4');
      await act(async () => Simulate.blur(radius));

      const powerScale = host.querySelector(
        'input[aria-label="Power scale for inspected artwork"]',
      );
      if (!(powerScale instanceof HTMLInputElement)) throw new Error('power scale input missing');
      await change(powerScale, '80');
      await act(async () => Simulate.blur(powerScale));

      expect(useStore.getState().selectedObjectId).toBeNull();
      expect(useStore.getState().project.scene.objects[0]).toMatchObject({
        powerScale: 80,
        spec: { kind: 'rect', cornerRadiusMm: 4 },
      });
      expect(host.querySelector('[aria-label="Artwork operation"]')).not.toBeNull();
    } finally {
      await cleanup(root, host);
    }
  });

  it('uses one artwork chooser when several unselected artworks are on the canvas', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.getState().selectObject(null);
    const { host, root } = await render();
    try {
      const chooser = host.querySelector('select[aria-label="Artwork to inspect"]');
      if (!(chooser instanceof HTMLSelectElement)) throw new Error('artwork chooser missing');
      expect(chooser.options).toHaveLength(2);
      await choose(chooser, 'O2');
      const mode = host.querySelector('select[aria-label="Mode for inspected artwork"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('operation mode missing');
      await choose(mode, 'fill');

      const state = useStore.getState();
      expect(state.selectedObjectId).toBeNull();
      expect(state.additionalSelectedIds.size).toBe(0);
      expect(state.project.scene.layers.find((layer) => layer.name === 'O1')?.mode).toBe('line');
      expect(state.project.scene.layers.find((layer) => layer.name === 'O2')?.mode).toBe('fill');
      expect(host.querySelectorAll('[aria-label="Artwork operation"]')).toHaveLength(1);
    } finally {
      await cleanup(root, host);
    }
  });

  it('remembers the last selected artwork when the canvas selection is cleared', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.getState().selectObject('O2');
    const { host, root } = await render();
    try {
      await act(async () => useStore.getState().selectObject(null));
      const chooser = host.querySelector('select[aria-label="Artwork to inspect"]');
      if (!(chooser instanceof HTMLSelectElement)) throw new Error('artwork chooser missing');
      expect(chooser.value).toBe('O2');
      expect(useStore.getState().selectedObjectId).toBeNull();
    } finally {
      await cleanup(root, host);
    }
  });

  it('shows default power scale for one selected object', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    const { host, root } = await render();
    try {
      const input = host.querySelector('input[aria-label="Power scale for selected objects"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('power scale input missing');
      expect(input.value).toBe('100');
    } finally {
      await cleanup(root, host);
    }
  });

  it('commits power scale edits to the selected object on blur', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    const { host, root } = await render();
    try {
      const input = host.querySelector('input[aria-label="Power scale for selected objects"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('power scale input missing');
      await change(input, '50');
      await act(async () => {
        Simulate.blur(input);
      });

      expect(useStore.getState().project.scene.objects[0]?.powerScale).toBe(50);
    } finally {
      await cleanup(root, host);
    }
  });

  it('shows the selected artwork CNC operation in CNC mode', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Selected object properties"]')).not.toBeNull();
      expect(host.querySelector('select[aria-label^="Cut type for"]')).not.toBeNull();
      expect(host.querySelector('input[aria-label="Power scale for selected objects"]')).toBeNull();
    } finally {
      await cleanup(root, host);
    }
  });

  // The toolbar's W/H resize writes object.transform scale and never touches
  // object.spec, so a panel that reported the raw spec drifted out of step with
  // the toolbar the moment either surface was used. Both name the same
  // millimetres on the bed; they must agree.
  it('reports the scaled size, not the raw spec, after a toolbar resize', async () => {
    useStore.getState().drawShape(rectangle('rect-1'));
    useStore.getState().selectObject('rect-1');
    // What the toolbar does when you type 80 into W with the AR lock off.
    const object = useStore.getState().project.scene.objects[0];
    if (object === undefined) throw new Error('rectangle missing');
    useStore
      .getState()
      .applySelectionTransforms([
        { id: 'rect-1', transform: { ...object.transform, scaleX: 2, scaleY: 3 } },
      ]);
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Rectangle width"]');
      const height = host.querySelector('input[aria-label="Rectangle height"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      if (!(height instanceof HTMLInputElement)) throw new Error('height input missing');
      expect(width.value).toBe('80');
      expect(height.value).toBe('60');
    } finally {
      await cleanup(root, host);
    }
  });

  it('divides out the scale when a size is typed into the panel', async () => {
    useStore.getState().drawShape(rectangle('rect-1'));
    useStore.getState().selectObject('rect-1');
    const object = useStore.getState().project.scene.objects[0];
    if (object === undefined) throw new Error('rectangle missing');
    useStore
      .getState()
      .applySelectionTransforms([
        { id: 'rect-1', transform: { ...object.transform, scaleX: 2, scaleY: 2 } },
      ]);
    const { host, root } = await render();
    try {
      const width = host.querySelector('input[aria-label="Rectangle width"]');
      if (!(width instanceof HTMLInputElement)) throw new Error('width input missing');
      await change(width, '100');
      await act(async () => Simulate.blur(width));
      const after = useStore.getState().project.scene.objects[0];
      if (after?.kind !== 'shape' || after.spec.kind !== 'rect') throw new Error('not a rectangle');
      // 100 mm on the bed at 2x scale is a 50 mm spec.
      expect(after.spec.widthMm).toBeCloseTo(50, 6);
    } finally {
      await cleanup(root, host);
    }
  });

  it('rematerializes a rectangle when its corner radius is edited', async () => {
    useStore.getState().drawShape(rectangle('rect-1'));
    const before = useStore.getState().project.scene.objects[0];
    const { host, root } = await render();
    try {
      const input = host.querySelector('input[aria-label="Rectangle corner radius"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('corner radius input missing');
      await change(input, '5');
      await act(async () => {
        Simulate.blur(input);
      });

      const after = useStore.getState().project.scene.objects[0];
      expect(after).toMatchObject({
        id: 'rect-1',
        spec: { kind: 'rect', widthMm: 40, heightMm: 20, cornerRadiusMm: 5 },
      });
      expect(after).not.toEqual(before);
      expect(
        after !== undefined && 'paths' in after
          ? after.paths[0]?.curves?.[0]?.segments.some((segment) => segment.kind === 'cubic')
          : false,
      ).toBe(true);
    } finally {
      await cleanup(root, host);
    }
  });

  it('keeps parametric geometry controls available in CNC mode', async () => {
    useStore.getState().drawShape(rectangle('rect-1'));
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await render();
    try {
      expect(host.querySelector('input[aria-label="Rectangle width"]')).not.toBeNull();
      expect(host.querySelector('input[aria-label="Power scale for selected objects"]')).toBeNull();
    } finally {
      await cleanup(root, host);
    }
  });

  it('edits the selected artwork operation without changing same-colored artwork', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.getState().selectObject('O2');
    const { host, root } = await render();
    try {
      const mode = host.querySelector('select[aria-label="Mode for selected objects"]');
      if (!(mode instanceof HTMLSelectElement)) throw new Error('selected mode control missing');
      await choose(mode, 'fill');

      const state = useStore.getState();
      expect(state.project.scene.layers.find((layer) => layer.name === 'O1')?.mode).toBe('line');
      expect(state.project.scene.layers.find((layer) => layer.name === 'O2')?.mode).toBe('fill');
      expect(
        state.project.scene.objects.every((object) => object.operationOverride === undefined),
      ).toBe(true);
    } finally {
      await cleanup(root, host);
    }
  });

  it('keeps top-level run ordering out of the selected-artwork settings inspector', async () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Box', ['#000000']));
    useStore.getState().selectObject('Box');
    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Selected artwork operation"]')).not.toBeNull();
      expect(host.textContent).not.toContain('Artwork run priority');
      expect(
        [...host.querySelectorAll('button')].some((button) =>
          ['First', 'Earlier', 'Later', 'Last'].includes(button.textContent ?? ''),
        ),
      ).toBe(false);
      expect(useStore.getState().project.scene.artworkOrder).toEqual(['Johann', 'Box']);
    } finally {
      await cleanup(root, host);
    }
  });

  it('offers one unified operation when selected artworks have different settings', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#000000']));
    useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set(['O2']) });

    const { host, root } = await render();
    try {
      expect(host.querySelector('[aria-label="Multiple artwork operations"]')).not.toBeNull();
      const unify = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Use one operation for selection',
      );
      if (!(unify instanceof HTMLButtonElement)) throw new Error('unify button missing');
      await act(async () => unify.click());
      const state = useStore.getState();
      expect(state.project.scene.objects.map((object) => object.operationIds)).toEqual([
        [state.project.scene.layers[0]?.id],
        [state.project.scene.layers[0]?.id],
      ]);
    } finally {
      await cleanup(root, host);
    }
  });

  it.each(TARGET_SWITCH_CASES)(
    'does not retarget a pending %s edit',
    async (kind, value, label) => {
      vi.useFakeTimers();
      seedTargetSwitch(kind);
      const before = JSON.stringify(useStore.getState().project);
      const { host, root } = await render();
      try {
        const input = host.querySelector(`input[aria-label="${label}"]`);
        if (!(input instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
        await change(input, value);
        await switchTarget(kind, host);
        await act(async () => vi.advanceTimersByTime(300));
        expect(JSON.stringify(useStore.getState().project)).toBe(before);
      } finally {
        await cleanup(root, host);
      }
    },
  );
});
