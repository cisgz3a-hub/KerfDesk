// The workspace accuracy map (ADR-441 Amendment 1): each saved ring is drawn
// where it was engraved, through the canvas view, coloured by its error; the
// target's outline marks where the error was measured.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import { CameraAccuracyMap } from './CameraAccuracyMap';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW = { scale: 2, offsetX: 30, offsetY: 10 };

function withRings(): CameraModelRecord {
  const model = savedCameraModel();
  return {
    ...model,
    accuracy: {
      ...model.accuracy,
      targetArea: { x: 5, y: 5, width: 390, height: 390 },
      marks: [
        { x: 25, y: 25, dxMm: 0.1, dyMm: 0 },
        { x: 65, y: 25, dxMm: 0.4, dyMm: 0.2 },
        { x: 105, y: 25, dxMm: 0.9, dyMm: 0 },
        { x: 145, y: 25, dxMm: 3, dyMm: 1, rejected: true },
      ],
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(model: CameraModelRecord): void {
  act(() => root.render(<CameraAccuracyMap model={model} view={VIEW} width={800} height={600} />));
}

describe('CameraAccuracyMap', () => {
  it('draws every ring where it was engraved, coloured by its error', () => {
    render(withRings());
    const circles = [...container.querySelectorAll('circle')];
    expect(circles.map((c) => [c.getAttribute('cx'), c.getAttribute('cy')])).toEqual([
      ['80', '60'],
      ['160', '60'],
      ['240', '60'],
      ['320', '60'],
    ]);
    expect(circles.map((c) => c.getAttribute('fill'))).toEqual([
      'var(--lf-success-fg)',
      'var(--lf-warning-fg)',
      'var(--lf-danger-fg)',
      'none',
    ]);
    expect(circles[3]?.getAttribute('stroke')).toBe('var(--lf-danger-fg)');
  });

  it('outlines the measured area and says the rest is extrapolated', () => {
    render(withRings());
    const outline = container.querySelector('rect');
    expect([outline?.getAttribute('x'), outline?.getAttribute('width')]).toEqual(['40', '780']);
    expect(container.textContent).toContain('Camera accuracy at 3 mm');
    expect(container.textContent).toContain('Outside the dashed outline');
  });

  it('draws nothing for a calibration saved without its rings', () => {
    render(savedCameraModel());
    expect(container.innerHTML).toBe('');
  });
});
