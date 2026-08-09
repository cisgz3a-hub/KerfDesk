import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReliefHeightfieldProvenance } from '../../core/scene/relief';
import { ReliefRecordedSourceDetails } from './ReliefRecordedSourceDetails';

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
});
