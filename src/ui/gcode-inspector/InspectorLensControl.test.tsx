import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgramTime, type MotionLimits } from '../../core/gcode-time';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { resolveViewer3dTheme } from '../viewer3d';
import { InspectorLensControl } from './InspectorLensControl';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

const PROGRAM = [
  'G21 G90',
  'G0 Z5',
  'G1 Z-1 F200',
  'G1 X10 F600',
  'G0 Z5',
  'G1 Z-2 F200',
  'G1 X20 F600',
].join('\n');

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('InspectorLensControl', () => {
  it('explains the ordered depth/pass scale with exact endpoints', () => {
    render('depth');
    const text = host?.textContent ?? '';
    expect(text).toContain('2 depth levels');
    expect(text).toContain('Shallow -1.00 mm');
    expect(text).toContain('Deep -2.00 mm');
    expect(host?.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain(
      'light to dark',
    );
  });

  it('offers and reports the single tool-colour override', () => {
    render('tool');
    const select = host?.querySelector<HTMLSelectElement>('[aria-label="Colour lens"]');
    expect(select?.value).toBe('tool');
    expect(host?.textContent ?? '').toContain('Toolpath');
    expect(host?.textContent ?? '').toContain('Traversal');
  });

  it('reports an accessible lens change', () => {
    const onLensChange = vi.fn();
    render('depth', onLensChange);
    const select = host?.querySelector<HTMLSelectElement>('[aria-label="Colour lens"]');
    act(() => {
      if (select === null || select === undefined) return;
      select.value = 'tool';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onLensChange).toHaveBeenCalledWith('tool');
  });
});

function render(lens: 'depth' | 'tool', onLensChange = vi.fn()): void {
  const parsed = buildGcodeRenderModel(PROGRAM);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const model = parsed.model;
  const time = buildProgramTime(model, LIMITS);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <InspectorLensControl
        model={model}
        time={time}
        theme={resolveViewer3dTheme(null)}
        lens={lens}
        onLensChange={onLensChange}
        variant="overlay"
      />,
    );
  });
}
