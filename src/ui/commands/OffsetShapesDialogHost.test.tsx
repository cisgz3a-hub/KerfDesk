import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
} from '../../core/scene';
import { setActiveEdition } from '../licensing/edition';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { OffsetShapesDialogHost, resetOffsetShapesDialogMemory } from './OffsetShapesDialogHost';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  resetOffsetShapesDialogMemory();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  setActiveEdition(null);
});

function square(size: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'sq',
    source: 'sq.svg',
    bounds: { minX: 0, minY: 0, maxX: size, maxY: size },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: size, y: 0 },
              { x: size, y: size },
              { x: 0, y: size },
            ],
          },
        ],
      },
    ],
  };
}

function load(size: number, proOperation = false): void {
  const layer = createLayer({ id: 'cut', color: '#000000' });
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [square(size)],
        layers: [
          proOperation
            ? { ...layer, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' } }
            : layer,
        ],
        groups: [],
      },
    },
    selectedObjectId: 'sq',
    additionalSelectedIds: new Set(),
  });
}

async function render(onClose = vi.fn()) {
  await act(async () => root.render(<OffsetShapesDialogHost onClose={onClose} />));
  return onClose;
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.ownerDocument.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  );
  if (found === undefined) throw new Error(`${label} button missing`);
  return found;
}

function status(): string {
  return host.ownerDocument.querySelector('[role="status"]')?.textContent ?? '';
}

async function setDistance(value: string): Promise<void> {
  const input = host.ownerDocument.querySelector<HTMLInputElement>('input[type="number"]');
  if (input === null) throw new Error('distance input missing');
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

describe('Offset Shapes dialog', () => {
  it.each([false, true])('keeps a Pro copy pending until admission (Pro=%s)', async (pro) => {
    load(10, true);
    const requestPro = vi.fn((_feature: string, _allowed?: () => void) => false);
    setActiveEdition({ status: null, licensed: true, pro, requestPro, openLicence: vi.fn() });
    const before = useStore.getState().project;
    const onClose = await render();
    await act(async () => button('Offset').click());
    if (pro) {
      expect(onClose).toHaveBeenCalledOnce();
      expect(requestPro).not.toHaveBeenCalled();
    } else {
      expect(useStore.getState().project).toBe(before);
      expect(onClose).not.toHaveBeenCalled();
      expect(requestPro).toHaveBeenCalledWith('vcarve', expect.any(Function));
      setActiveEdition({
        status: null,
        licensed: true,
        pro: true,
        requestPro,
        openLicence: vi.fn(),
      });
      await act(async () => requestPro.mock.calls[0]?.[1]?.());
      expect(onClose).not.toHaveBeenCalled();
    }
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(useStore.getState().project.scene.layers[1]?.cnc?.cutType).toBe('v-carve');
  });

  it('applies a single replacement of existing Pro artwork and closes in Free', async () => {
    load(10, true);
    const requestPro = vi.fn();
    setActiveEdition({
      status: null,
      licensed: true,
      pro: false,
      requestPro,
      openLicence: vi.fn(),
    });
    const onClose = await render();
    const checkbox = [...host.ownerDocument.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Delete original objects'))
      ?.querySelector<HTMLInputElement>('input');
    if (checkbox === null || checkbox === undefined) throw new Error('delete originals missing');
    await act(async () => {
      checkbox.checked = true;
      Simulate.change(checkbox);
    });
    await act(async () => button('Offset').click());
    expect(requestPro).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(useStore.getState().project.scene.objects[0]?.id).not.toBe('sq');
    expect(useStore.getState().project.scene.layers[0]?.cnc?.cutType).toBe('v-carve');
  });

  it('previews the result size and adds both offsets on submit', async () => {
    const requestPro = vi.fn();
    setActiveEdition({
      status: null,
      licensed: true,
      pro: false,
      requestPro,
      openLicence: vi.fn(),
    });
    load(10);
    const onClose = await render();
    await setDistance('2');
    await act(async () => Simulate.click(button('Both')));
    await act(async () => Simulate.click(button('Corner')));

    expect(status()).toBe('Adds two new shapes: outward 14.00 × 14.00 mm, inward 6.00 × 6.00 mm.');
    expect(host.ownerDocument.querySelector('[data-testid="offset-preview-in"]')).not.toBeNull();

    await act(async () => button('Offset').click());

    expect(useStore.getState().project.scene.objects).toHaveLength(3);
    expect(onClose).toHaveBeenCalledOnce();
    expect(requestPro).not.toHaveBeenCalled();
  });

  it('explains a collapsed inward offset and keeps Offset unavailable', async () => {
    load(4);
    await render();
    await setDistance('3');
    await act(async () => Simulate.click(button('Inward')));

    expect(status()).toContain('collapsed');
    expect(button('Offset').disabled).toBe(true);
  });

  it('reopens with the settings last applied', async () => {
    load(10);
    await render();
    await setDistance('3');
    await act(async () => Simulate.click(button('Bevel')));
    await act(async () => button('Offset').click());
    await act(async () => root.render(<></>));

    await render();

    const input = host.ownerDocument.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input?.value).toBe('3');
    expect(button('Bevel').getAttribute('aria-pressed')).toBe('true');
  });
});
