import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateMaterialTestGrid } from '../../core/job';
import { materialTestAxis } from '../../core/job/material-test-axes';
import { MaterialTestDialog } from './MaterialTestDialog';
import { DEFAULT_MATERIAL_TEST_DRAFT, parseMaterialTestDraft } from './material-test-draft';
import { materialTestPreview } from './material-test-preview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('MaterialTestDialog test card preview (ADR-497)', () => {
  it('labels every row and column with the values Generate burns', async () => {
    const { host, root } = await renderDialog(3000);
    try {
      const options = {
        ...parseMaterialTestDraft(DEFAULT_MATERIAL_TEST_DRAFT),
        maxFeedMmPerMin: 3000,
      };
      expect(texts(host, 'row-labels')).toEqual(materialTestAxis('speed', 10, options).labels);
      expect(texts(host, 'column-labels')).toEqual(materialTestAxis('power', 10, options).labels);
      expect(texts(host, 'row-labels')[0]).toBe('3000');
      expect(texts(host, 'column-labels')[0]).toBe('10');
      const titles = cellTitles(host);
      expect(titles).toHaveLength(100);
      expect(titles[0]).toBe("Speed 3000 mm/min, power 10%: 8% of the deepest burn's energy");
      expect(titles[99]).toBe("Speed 1000 mm/min, power 40%: 100% of the deepest burn's energy");
      expect(preview(host).getAttribute('aria-label')).toBe(
        'Test card preview. 10 by 10 engraved test card: rows vary speed from 3000 to 1000 mm/min; ' +
          'columns vary power from 10 to 40%. Darker cells get more energy; the deepest gets 12 ' +
          'times the faintest. Cells: 5 × 5 mm. Cell proportions shown; spacing is schematic.',
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shows speeds capped at the profile maximum feed, as the job runs them', async () => {
    const { host, root } = await renderDialog(2000);
    try {
      const options = {
        ...parseMaterialTestDraft(DEFAULT_MATERIAL_TEST_DRAFT),
        maxFeedMmPerMin: 2000,
      };
      const speeds = materialTestAxis('speed', 10, options);
      expect(speeds.values[0]).toBe(3000);
      expect(texts(host, 'row-labels')).toEqual(speeds.labels);
      expect(texts(host, 'row-labels').slice(0, 5)).toEqual([
        '2000',
        '2000',
        '2000',
        '2000',
        '2000',
      ]);
      expect(cellTitles(host)[0]).toMatch(/^Speed 2000 mm\/min, power 10%/);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('draws the rows a cut passes test really holds, as outlines', async () => {
    const { host, root } = await renderDialog(3000);
    try {
      await choose(host, 'Test', 'line');
      await choose(host, 'Rows vary', 'passes');
      await choose(host, 'Columns vary', 'speed');
      await type(host, 'Max passes', '4');
      expect(texts(host, 'row-labels')).toEqual(['1', '2', '3', '4']);
      expect(texts(host, 'column-labels')[0]).toBe('3000');
      const cells = [...host.querySelectorAll('[data-part="cells"] rect')];
      expect(cells).toHaveLength(40);
      expect(cells.every((cell) => cell.getAttribute('fill') === 'var(--lf-bg-input)')).toBe(true);
      expect(preview(host).getAttribute('aria-label')).toContain('4 by 10 cut test card');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('dims the last valid card while a field is invalid and leaves Generate unchanged', async () => {
    const { host, root, onGenerate } = await renderDialog(3000);
    try {
      await type(host, 'Rows', '');
      expect(preview(host).style.opacity).toBe('0.35');
      expect(preview(host).getAttribute('aria-label')).toMatch(/^Test card preview, paused/);
      expect(cellTitles(host)).toHaveLength(100);
      await type(host, 'Rows', '3');
      expect(preview(host).style.opacity).toBe('1');
      expect(texts(host, 'row-labels')).toEqual(['3000', '2000', '1000']);
      await clickGenerate(host);
      expect(onGenerate).toHaveBeenCalledWith(
        parseMaterialTestDraft({ ...DEFAULT_MATERIAL_TEST_DRAFT, rows: '3' }),
      );
    } finally {
      await act(async () => root.unmount());
    }
  });
});

describe('materialTestPreview', () => {
  it.each([
    ['speed by power, capped', DEFAULT_MATERIAL_TEST_DRAFT, 2000],
    [
      'power by hatch spacing',
      {
        ...DEFAULT_MATERIAL_TEST_DRAFT,
        rowParameter: 'power',
        columnParameter: 'interval',
        rows: '4',
        columns: '3',
        speed: '2600',
      },
      2400,
    ],
    [
      'passes by speed cut',
      {
        ...DEFAULT_MATERIAL_TEST_DRAFT,
        mode: 'line',
        rowParameter: 'passes',
        columnParameter: 'speed',
        passesMax: '3',
      },
      2500,
    ],
  ] as const)('matches every cell Generate makes: %s', (_, draft, maxFeedMmPerMin) => {
    const options = { ...parseMaterialTestDraft(draft), maxFeedMmPerMin };
    const model = materialTestPreview(options);
    const grid = generateMaterialTestGrid(options);
    expect(model.cells.map(({ energy: _energy, ...cell }) => cell)).toEqual(
      grid.cells.map((cell) => ({
        row: cell.row,
        column: cell.column,
        speed: cell.effectiveSpeed,
        power: cell.power,
        passes: cell.passes,
        ...(cell.intervalMm === undefined ? {} : { intervalMm: cell.intervalMm }),
      })),
    );
    expect(Math.max(...model.cells.map((cell) => cell.energy))).toBe(1);
  });
});

async function renderDialog(maxFeedMmPerMin: number): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onGenerate: ReturnType<typeof vi.fn>;
}> {
  const onGenerate = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MaterialTestDialog
        onCancel={vi.fn()}
        onGenerate={onGenerate}
        maxFeedMmPerMin={maxFeedMmPerMin}
      />,
    );
  });
  return { host, root, onGenerate };
}

function preview(host: HTMLElement): HTMLElement {
  const element = host.querySelector('[role="img"][aria-label^="Test card preview"]');
  if (!(element instanceof HTMLElement)) throw new Error('preview missing');
  return element;
}

function texts(host: HTMLElement, part: string): ReadonlyArray<string> {
  return [...preview(host).querySelectorAll(`[data-part="${part}"] text`)].map(
    (element) => element.textContent ?? '',
  );
}

function cellTitles(host: HTMLElement): ReadonlyArray<string> {
  return [...preview(host).querySelectorAll('[data-part="cells"] title')].map(
    (element) => element.textContent ?? '',
  );
}

async function choose(host: HTMLElement, label: string, value: string): Promise<void> {
  const element = host.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} select missing`);
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function type(host: HTMLElement, label: string, value: string): Promise<void> {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function clickGenerate(host: HTMLElement): Promise<void> {
  const generate = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Generate'),
  );
  if (!(generate instanceof HTMLButtonElement)) throw new Error('Generate button missing');
  await act(async () => {
    generate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
