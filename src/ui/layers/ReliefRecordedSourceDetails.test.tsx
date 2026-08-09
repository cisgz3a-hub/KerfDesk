import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import type { HeightfieldReliefObject, ReliefHeightfieldProvenance } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefRecordedSourceDetails } from './ReliefRecordedSourceDetails';
import { SelectedReliefProperties } from './SelectedReliefProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetStore());

function render(provenance: ReliefHeightfieldProvenance): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<ReliefRecordedSourceDetails provenance={provenance} />);
  return host;
}

function details(host: HTMLElement): HTMLElement {
  const section = host.querySelector('[aria-label="Relief recorded source details"]');
  if (!(section instanceof HTMLElement)) throw new Error('recorded source details missing');
  return section;
}

function valueFor(host: HTMLElement, label: string): string | null {
  const row = [...details(host).querySelectorAll('div')].find(
    (candidate) => candidate.querySelector('dt')?.textContent === label,
  );
  return row?.querySelector('dd')?.textContent ?? null;
}

describe('ReliefRecordedSourceDetails', () => {
  it('shows every recorded value and no interactive controls', () => {
    const host = render({
      sourceKind: 'relative-depth-map',
      sourceName: 'portrait-depth.png',
      sourceBitDepth: 16,
      sourcePolarity: 'light-is-high',
      producer: { name: 'Depth Lab', model: 'depth-v2', version: '2026.08' },
    });

    expect(details(host).textContent).toContain('Recorded source details');
    expect(details(host).textContent).toContain('Recorded metadata is not authenticated.');
    expect(valueFor(host, 'Source name')).toBe('portrait-depth.png');
    expect(valueFor(host, 'Source bit depth')).toBe('16-bit');
    expect(valueFor(host, 'Recorded source polarity')).toBe('Light is high');
    expect(valueFor(host, 'Producer name')).toBe('Depth Lab');
    expect(valueFor(host, 'Producer model')).toBe('depth-v2');
    expect(valueFor(host, 'Producer version')).toBe('2026.08');
    expect(details(host).querySelector('input, select, button')).toBeNull();
  });

  it('shows Not recorded for every absent optional value', () => {
    const host = render({ sourceKind: 'depth-map', sourceName: 'depth.png' });

    expect(valueFor(host, 'Source name')).toBe('depth.png');
    expect(valueFor(host, 'Source bit depth')).toBe('Not recorded');
    expect(valueFor(host, 'Recorded source polarity')).toBe('Not recorded');
    expect(valueFor(host, 'Producer name')).toBe('Not recorded');
    expect(valueFor(host, 'Producer model')).toBe('Not recorded');
    expect(valueFor(host, 'Producer version')).toBe('Not recorded');
  });

  it('treats whitespace-only strings as missing but preserves nonblank strings exactly', () => {
    const host = render({
      sourceKind: 'editable-relief-map',
      sourceName: ' \t ',
      sourceBitDepth: 8,
      producer: { name: '\n', model: '  authored-map-v1  ', version: '' },
    });

    expect(valueFor(host, 'Source name')).toBe('Not recorded');
    expect(valueFor(host, 'Source bit depth')).toBe('8-bit');
    expect(valueFor(host, 'Recorded source polarity')).toBe('Not recorded');
    expect(valueFor(host, 'Producer name')).toBe('Not recorded');
    expect(valueFor(host, 'Producer model')).toBe('  authored-map-v1  ');
    expect(valueFor(host, 'Producer version')).toBe('Not recorded');
  });

  it('keeps recorded source polarity distinct from the current editable mapping', async () => {
    const relief = heightfieldRelief();
    const base = createProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [relief],
        layers: [
          createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR }),
        ],
      },
    };
    useStore.setState({ project });
    useStore.getState().setMachineKind('cnc');
    useStore.getState().selectObject(relief.id);
    const beforeProject = useStore.getState().project;
    const beforeUndoStack = useStore.getState().undoStack;
    const beforeDirty = useStore.getState().dirty;
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(<SelectedReliefProperties />));
    try {
      const recorded = host.querySelector('[aria-label="Relief recorded source details"]');
      const current = host.querySelector('select[aria-label="Relief height-map polarity"]');
      expect(recorded?.textContent).toContain('recorded-depth.png');
      expect(recorded?.textContent).toContain('Recorded metadata is not authenticated.');
      expect(recorded?.textContent).toContain('Recorded source polarityLight is high');
      expect(recorded?.textContent).toContain('Depth Lab');
      expect(recorded?.textContent).toContain('relative-v2');
      expect(recorded?.querySelector('input, select, button')).toBeNull();
      expect(current).toBeInstanceOf(HTMLSelectElement);
      expect(current instanceof HTMLSelectElement ? current.value : null).toBe('light-is-deep');
      expect(useStore.getState().project).toBe(beforeProject);
      expect(useStore.getState().undoStack).toBe(beforeUndoStack);
      expect(useStore.getState().dirty).toBe(beforeDirty);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function heightfieldRelief(): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id: 'heightfield-relief',
    source: 'recorded-depth.png',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      samplesU8: [0, 255],
      mapping: { polarity: 'light-is-deep' },
      provenance: {
        sourceName: 'recorded-depth.png',
        sourcePolarity: 'light-is-high',
        producer: { name: 'Depth Lab', model: 'relative-v2' },
      },
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}
