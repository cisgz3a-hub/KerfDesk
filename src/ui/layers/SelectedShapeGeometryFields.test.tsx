import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShapeObject } from '../../core/scene';
import { createEllipse, createPolygon, createStar } from '../../core/shapes';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetStore());

describe('SelectedShapeGeometryFields', () => {
  it('updates ellipse dimensions', async () => {
    const ellipse = createEllipse({
      id: 'ellipse-1',
      color: '#ff0000',
      spec: { widthMm: 20, heightMm: 10 },
    });
    const view = await renderShape(ellipse);
    try {
      await editNumber(view.host, 'Ellipse width', '35');
      expect(selectedShape().spec).toEqual({ kind: 'ellipse', widthMm: 35, heightMm: 10 });
    } finally {
      await view.dispose();
    }
  });

  it('rounds a long-float dimension for display but keeps the stored value exact', async () => {
    // A drag-resized shape stores a long float that overflowed the input box.
    const ellipse = createEllipse({
      id: 'ellipse-precise',
      color: '#ff0000',
      spec: { widthMm: 20, heightMm: 35.107387681635146 },
    });
    const view = await renderShape(ellipse);
    try {
      const input = view.host.querySelector('input[aria-label="Ellipse height"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Ellipse height input missing');
      expect(input.value).toBe('35.107');
      // Display rounds; the underlying spec keeps full precision until edited.
      expect(selectedShape().spec).toMatchObject({ heightMm: 35.107387681635146 });
    } finally {
      await view.dispose();
    }
  });

  it('updates polygon side count and rematerializes its vertices', async () => {
    const polygon = createPolygon({
      id: 'polygon-1',
      color: '#00ff00',
      spec: { sides: 5, radiusMm: 12 },
    });
    const view = await renderShape(polygon);
    try {
      await editNumber(view.host, 'Polygon sides', '8');
      const selected = selectedShape();
      expect(selected.spec).toEqual({ kind: 'polygon', sides: 8, radiusMm: 12 });
      expect(selected.paths[0]?.polylines[0]?.points).toHaveLength(9);
    } finally {
      await view.dispose();
    }
  });

  it('updates star point and inset parameters', async () => {
    const star = createStar({
      id: 'star-1',
      color: '#0000ff',
      spec: { points: 5, outerRadiusMm: 15, innerRadiusRatio: 0.5 },
    });
    const view = await renderShape(star);
    try {
      await editNumber(view.host, 'Star points', '7');
      await editNumber(view.host, 'Star inner radius', '35');
      const selected = selectedShape();
      expect(selected.spec).toEqual({
        kind: 'star',
        points: 7,
        outerRadiusMm: 15,
        innerRadiusRatio: 0.35,
      });
      expect(selected.paths[0]?.polylines[0]?.points).toHaveLength(15);
    } finally {
      await view.dispose();
    }
  });
});

async function renderShape(shape: ShapeObject): Promise<{
  readonly host: HTMLDivElement;
  readonly dispose: () => Promise<void>;
}> {
  useStore.getState().drawShape(shape);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => root.render(<SelectedObjectProperties />));
  return {
    host,
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

async function editNumber(host: HTMLElement, ariaLabel: string, value: string): Promise<void> {
  const input = host.querySelector(`input[aria-label="${ariaLabel}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${ariaLabel} input missing`);
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
  await act(async () => Simulate.blur(input));
}

function selectedShape(): ShapeObject {
  const selected = useStore.getState().project.scene.objects[0];
  if (selected?.kind !== 'shape') throw new Error('selected shape missing');
  return selected;
}
