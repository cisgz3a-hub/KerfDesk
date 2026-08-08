import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { buildProgramTime, type MotionLimits } from '../../core/gcode-time';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { resolveViewer3dTheme } from '../viewer3d';
import { InspectorLensControl } from './InspectorLensControl';

// React 18 reads this test-only flag when act() drives our direct createRoot
// harness. This repository has no shared React DOM test setup, so DOM tests
// intentionally declare it at their boundary.
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

describe('InspectorLensControl', () => {
  it('explains the ordered depth/pass scale with exact endpoints', () => {
    const view = render('depth');
    try {
      const text = view.host.textContent ?? '';
      expect(text).toContain('2 depth levels');
      expect(text).toContain('Shallow -1.00 mm');
      expect(text).toContain('Deep -2.00 mm');
      expect(view.host.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain(
        'light blue to muted red',
      );
      expect(view.host.querySelector<HTMLElement>('[role="img"]')?.style.backgroundImage).toBe(
        'linear-gradient(to right, rgb(173, 209, 245), rgb(191, 112, 117))',
      );
    } finally {
      view.cleanup();
    }
  });

  it('offers and reports the single tool-colour override', () => {
    const view = render('tool');
    try {
      const select = view.host.querySelector<HTMLSelectElement>('[aria-label="Colour lens"]');
      expect(select?.value).toBe('tool');
      expect(view.host.textContent ?? '').toContain('Toolpath');
      expect(view.host.textContent ?? '').toContain('Traversal');
    } finally {
      view.cleanup();
    }
  });

  it('reports an accessible lens change', () => {
    const onLensChange = vi.fn();
    const view = render('depth', onLensChange);
    try {
      const select = view.host.querySelector<HTMLSelectElement>('[aria-label="Colour lens"]');
      act(() => {
        if (select === null) return;
        select.value = 'tool';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(onLensChange).toHaveBeenCalledWith('tool');
    } finally {
      view.cleanup();
    }
  });

  it('ignores an unrecognized DOM lens value', () => {
    const onLensChange = vi.fn();
    const view = render('depth', onLensChange);
    try {
      const select = view.host.querySelector<HTMLSelectElement>('[aria-label="Colour lens"]');
      act(() => {
        if (select === null) return;
        select.value = 'unknown';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(onLensChange).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });
});

function render(
  lens: 'depth' | 'tool',
  onLensChange = vi.fn(),
): { readonly host: HTMLDivElement; readonly cleanup: () => void } {
  const parsed = buildGcodeRenderModel(PROGRAM);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const model = parsed.model;
  const time = buildProgramTime(model, LIMITS);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
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
  return {
    host,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
