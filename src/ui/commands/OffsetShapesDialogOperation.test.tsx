// Offset Shapes dialog: the result operation and the loss notices (ADR-410
// Amendment 6; tools audit T1, T33-P2-1, T33-P2-2 and T33-P3-3).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
} from '../../core/scene';
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

function square(id: string, x: number, size: number, operationId: string): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + size, maxY: size },
    transform: IDENTITY_TRANSFORM,
    operationIds: [operationId],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 0 },
              { x: x + size, y: 0 },
              { x: x + size, y: size },
              { x, y: size },
            ],
          },
        ],
      },
    ],
  };
}

function load(objects: ImportedSvg[], layers: Layer[]): void {
  useStore.setState({
    project: { ...createProject(), scene: { objects, layers, groups: [] } },
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
  });
}

function select(): HTMLSelectElement {
  const found = host.ownerDocument.querySelector<HTMLSelectElement>(
    'select[aria-label="Result operation"]',
  );
  if (found === null) throw new Error('result operation picker missing');
  return found;
}

function alerts(): string {
  return [...host.ownerDocument.querySelectorAll('[role="alert"]')]
    .map((node) => node.textContent ?? '')
    .join(' ');
}

function button(label: string): HTMLButtonElement {
  const found = [...host.ownerDocument.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (found === undefined) throw new Error(`${label} button missing`);
  return found;
}

const guide = { ...createLayer({ id: 'guide', color: '#00aaff', name: 'Guide' }), output: false };
const cut = createLayer({ id: 'cut', color: '#000000', name: 'Cut' });

describe('Offset Shapes result operation', () => {
  it('names the operation, skips an output-off guide by default and warns when it is chosen', async () => {
    load([square('g', 0, 40, 'guide'), square('p', 60, 10, 'cut')], [guide, cut]);
    await act(async () => root.render(<OffsetShapesDialogHost onClose={vi.fn()} />));

    const options = [...select().options].map((option) => option.textContent);
    expect(options).toEqual(['Guide (line, output off)', 'Cut (line)']);
    expect(select().value).toBe('cut');
    expect(alerts()).toBe('');

    await act(async () => {
      select().value = 'guide';
      Simulate.change(select());
    });
    expect(alerts()).toContain('“Guide”, whose output is off');

    await act(async () => button('Offset').click());
    const offsetOperation = useStore.getState().project.scene.layers.at(-1);
    expect(offsetOperation?.output).toBe(false);
  });

  it('says when the outward offset is larger than the bed (T33-P3-4)', async () => {
    load([square('plate', 0, 40, 'cut')], [cut]);
    const { project } = useStore.getState();
    useStore.setState({ project: { ...project, device: { ...project.device, bedWidth: 41 } } });
    await act(async () => root.render(<OffsetShapesDialogHost onClose={vi.fn()} />));
    const status = () => host.ownerDocument.querySelector('[role="status"]')?.textContent ?? '';
    expect(status()).toContain(`larger than the 41 × ${project.device.bedHeight} mm bed`);
  });

  it('names a shape an inward offset collapses before Apply', async () => {
    load([square('plate', 0, 40, 'cut'), square('pin', 60, 2.5, 'cut')], [cut]);
    await act(async () => root.render(<OffsetShapesDialogHost onClose={vi.fn()} />));
    const input = host.ownerDocument.querySelector<HTMLInputElement>(
      'input[aria-label="Offset distance"]',
    );
    if (input === null) throw new Error('distance input missing');
    await act(async () => {
      input.value = '1.5';
      Simulate.change(input);
    });
    await act(async () => Simulate.click(button('Inward')));

    expect(alerts()).toContain('One shape gets no inward offset');
    expect(alerts()).toContain('a path');
  });
});
