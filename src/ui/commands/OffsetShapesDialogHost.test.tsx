import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
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

function load(size: number): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [square(size)],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
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
  it('previews the result size and adds both offsets on submit', async () => {
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
