// Picking the best burned cell (ADR-381): the grid preview, turning a cell
// into a preset, and applying it to one of the design's operations.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertMaterialTest } from '../../core/job/material-test-insertion';
import {
  createLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { MaterialTestResultsLauncher } from './MaterialTestResultsLauncher';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FILL_OP: Layer = {
  ...createLayer({ id: 'op-fill', color: '#ff0000', name: 'Photo fill', mode: 'fill' }),
  hatchSpacingMm: 0.2,
};
const LINE_OP: Layer = createLayer({ id: 'op-line', color: '#0000ff', name: 'Outline' });

function setUpTest(): ReadonlyArray<SceneObject> {
  resetStore();
  useToastStore.setState({ toasts: [] });
  const base = useStore.getState().project;
  const scene = { ...base.scene, layers: [FILL_OP, LINE_OP] };
  const result = insertMaterialTest(scene, base.device, {
    mode: 'fill',
    rowAxis: { parameter: 'speed', start: 3000, end: 1000, count: 3 },
    columnAxis: { parameter: 'power', start: 10, end: 40, count: 4 },
    base: {
      power: 30,
      speed: 1500,
      passes: 2,
      intervalMm: 0.08,
      airAssist: true,
      ditherAlgorithm: 'floyd-steinberg',
    },
    cellWidthMm: 5,
    cellHeightMm: 5,
    maxFeedMmPerMin: base.device.maxFeed,
  });
  if (result.kind !== 'inserted') throw new Error(result.reason);
  useStore.setState({ project: { ...base, scene: result.scene } });
  return result.scene.objects.filter((object) => result.objectIds.includes(object.id));
}

let testObjects: ReadonlyArray<SceneObject> = [];
beforeEach(() => {
  testObjects = setUpTest();
});
afterEach(() => {
  resetStore();
  document.body.innerHTML = '';
});

async function openResults(objects: ReadonlyArray<SceneObject> = testObjects) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MaterialTestResultsLauncher objects={objects} />));
  const pick = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Pick the best cell...',
  );
  if (pick !== undefined) await act(async () => pick.click());
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function cellButton(host: HTMLElement, row: number, column: number): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(
    `button[aria-label^="Material test, row ${row}, column ${column}:"]`,
  );
  if (found === null) throw new Error(`missing cell ${row},${column}`);
  return found;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((button) => button.textContent === text);
  if (found === undefined) throw new Error(`missing button ${text}`);
  return found;
}

describe('MaterialTestResultsDialog', () => {
  it('lays the cells out like the burned grid, labelled with their values', async () => {
    const view = await openResults();
    try {
      const grid = view.host.querySelector('[role="grid"]');
      expect(grid?.querySelectorAll('button')).toHaveLength(12);
      const headers = [...view.host.querySelectorAll('[role="columnheader"]')].map(
        (header) => header.textContent,
      );
      expect(headers).toEqual(['', '10', '20', '30', '40']);
      const rows = [...view.host.querySelectorAll('[role="rowheader"]')].map(
        (header) => header.textContent,
      );
      expect(rows).toEqual(['3,000', '2,000', '1,000']);
      expect(view.host.textContent).toContain('Rows: Speed (mm/min) · Columns: Power (%)');
    } finally {
      await view.close();
    }
  });

  it('picks a cell by click and moves the pick with the arrow keys', async () => {
    const view = await openResults();
    try {
      await act(async () => cellButton(view.host, 2, 3).click());
      expect(cellButton(view.host, 2, 3).getAttribute('aria-pressed')).toBe('true');
      expect(view.host.textContent).toContain('Material test, row 2, column 3');
      expect(view.host.textContent).toContain('Fill · 30% · 2,000 mm/min · 2 passes');
      await act(async () =>
        Simulate.keyDown(view.host.querySelector('[role="grid"]') as Element, {
          key: 'ArrowRight',
        }),
      );
      expect(cellButton(view.host, 2, 4).getAttribute('aria-pressed')).toBe('true');
      expect(cellButton(view.host, 2, 4).tabIndex).toBe(0);
      expect(cellButton(view.host, 2, 3).tabIndex).toBe(-1);
    } finally {
      await view.close();
    }
  });

  it('applies the cell to a design operation, never to the test itself', async () => {
    const view = await openResults();
    try {
      await act(async () => cellButton(view.host, 3, 2).click());
      const target = view.host.querySelector<HTMLSelectElement>(
        'select[aria-label="Operation to apply the cell to"]',
      );
      expect([...(target?.options ?? [])].map((option) => option.value)).toEqual([
        'op-fill',
        'op-line',
      ]);
      await act(async () => buttonByText(view.host, 'Apply to operation').click());
      const fill = useStore.getState().project.scene.layers.find((l) => l.id === 'op-fill');
      expect(fill).toMatchObject({
        mode: 'fill',
        power: 20,
        speed: 1000,
        passes: 2,
        airAssist: true,
        hatchSpacingMm: 0.08,
      });
      expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
        'Applied Material test, row 3, column 2 to Photo fill.',
      );
    } finally {
      await view.close();
    }
  });

  it('keeps a Line operation in Line mode and says the interval stays', async () => {
    const view = await openResults();
    try {
      await act(async () => cellButton(view.host, 1, 1).click());
      const target = view.host.querySelector<HTMLSelectElement>(
        'select[aria-label="Operation to apply the cell to"]',
      );
      await act(async () => {
        if (target === null) throw new Error('missing select');
        target.value = 'op-line';
        Simulate.change(target);
      });
      expect(view.host.textContent).toContain('The Fill interval is not applied');
      await act(async () => buttonByText(view.host, 'Apply to operation').click());
      const line = useStore.getState().project.scene.layers.find((l) => l.id === 'op-line');
      expect(line).toMatchObject({ mode: 'line', power: 10, speed: 3000, passes: 2 });
      expect(line?.hatchSpacingMm).toBe(LINE_OP.hatchSpacingMm);
    } finally {
      await view.close();
    }
  });

  it('turns the picked cell into a calibrated preset', async () => {
    const view = await openResults();
    try {
      await act(async () => cellButton(view.host, 2, 4).click());
      await act(async () => buttonByText(view.host, 'New preset from this cell...').click());
      const wizard = view.host.querySelector<HTMLElement>('[aria-label="New material preset"]');
      if (wizard === null) throw new Error('wizard not open');
      expect(wizard.textContent).toContain('Settings from Material test, row 2, column 4.');
      for (const [label, value] of [
        ['Material name', 'Cherry'],
        ['Material thickness millimeters', '4'],
      ] as const) {
        const field = wizard.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
        await act(async () => {
          if (field === null) throw new Error(`missing ${label}`);
          field.value = value;
          Simulate.change(field);
        });
      }
      for (let step = 0; step < 4; step++) {
        await act(async () =>
          wizard.querySelector<HTMLButtonElement>('button[type="submit"]')?.click(),
        );
      }
      const saved = useStore.getState().materialLibrary?.entries[0];
      expect(saved?.recipe).toMatchObject({
        mode: 'fill',
        power: 40,
        speed: 2000,
        passes: 2,
        hatchSpacingMm: 0.08,
      });
      expect(saved?.confidence).toBe('calibrated');
      expect(saved?.calibrationProvenance).toContain('Material test, row 2, column 4');
    } finally {
      await view.close();
    }
  });

  it('stays out of the way for other artwork and on CNC machines', async () => {
    const other = await openResults([]);
    try {
      expect(other.host.textContent).toBe('');
    } finally {
      await other.close();
    }
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    const cnc = await openResults();
    try {
      expect(cnc.host.textContent).toBe('');
    } finally {
      await cnc.close();
    }
  });
});
