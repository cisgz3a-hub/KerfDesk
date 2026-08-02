import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShapeObject } from '../../core/scene';
import { createEllipse, createPolygon, createStar } from '../../core/shapes/primitives';
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

  it('keeps a toolbar resize when the field is blurred untouched', async () => {
    // Audit finding: a toolbar resize scales the TRANSFORM, not the spec. The
    // field kept showing the pre-resize size, and blurring it wrote that
    // stale size back — silently undoing the live resize.
    const ellipse = createEllipse({
      id: 'ellipse-resize',
      color: '#ff0000',
      spec: { widthMm: 40, heightMm: 10 },
    });
    const view = await renderShape(ellipse);
    try {
      await act(async () => {
        useStore.setState((s) => ({
          project: {
            ...s.project,
            scene: {
              ...s.project.scene,
              objects: s.project.scene.objects.map((object) =>
                object.id === 'ellipse-resize' && object.kind === 'shape'
                  ? { ...object, transform: { ...object.transform, scaleX: 2 } }
                  : object,
              ),
            },
          },
        }));
      });
      const input = view.host.querySelector('input[aria-label="Ellipse width"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Ellipse width input missing');
      // The field reports bed millimetres, so it must follow the resize…
      expect(input.value).toBe('80');
      // …and blurring the untouched field must not rewrite the spec.
      await act(async () => Simulate.blur(input));
      expect(selectedShape().spec).toMatchObject({ widthMm: 40 });
      expect(Math.abs(selectedShape().transform.scaleX)).toBe(2);
    } finally {
      await view.dispose();
    }
  });

  it('refreshes the displayed size after a canvas resize scales the transform', async () => {
    // A canvas drag-resize scales `transform` and never rewrites the spec, so
    // the field's committed value (spec units) is unchanged — only the bed-mm
    // display quantity moves. The stale-display bug froze the box at the
    // pre-drag number until the selection changed.
    const ellipse = createEllipse({
      id: 'ellipse-scaled',
      color: '#ff0000',
      spec: { widthMm: 20, heightMm: 10 },
    });
    const view = await renderShape(ellipse);
    try {
      const input = (): HTMLInputElement => {
        const found = view.host.querySelector('input[aria-label="Ellipse width"]');
        if (!(found instanceof HTMLInputElement)) throw new Error('Ellipse width input missing');
        return found;
      };
      expect(input().value).toBe('20');
      const object = useStore.getState().project.scene.objects[0];
      if (object === undefined) throw new Error('ellipse missing');
      await act(async () =>
        useStore
          .getState()
          .applySelectionTransforms([
            { id: 'ellipse-scaled', transform: { ...object.transform, scaleX: 2 } },
          ]),
      );
      expect(input().value).toBe('40');
    } finally {
      await view.dispose();
    }
  });

  it('cancels a pending dimension commit when a canvas resize changes its scale', async () => {
    const ellipse = createEllipse({
      id: 'ellipse-pending-resize',
      color: '#ff0000',
      spec: { widthMm: 20, heightMm: 10 },
    });
    const view = await renderShape(ellipse);
    try {
      const input = view.host.querySelector('input[aria-label="Ellipse width"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Ellipse width input missing');
      await act(async () => {
        input.value = '30';
        Simulate.change(input);
      });
      const object = useStore.getState().project.scene.objects[0];
      if (object === undefined) throw new Error('ellipse missing');
      await act(async () =>
        useStore
          .getState()
          .applySelectionTransforms([
            { id: 'ellipse-pending-resize', transform: { ...object.transform, scaleX: 2 } },
          ]),
      );
      await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));

      expect(selectedShape().spec).toMatchObject({ widthMm: 20 });
      expect(Math.abs(selectedShape().transform.scaleX)).toBe(2);
      const refreshed = view.host.querySelector('input[aria-label="Ellipse width"]');
      if (!(refreshed instanceof HTMLInputElement)) throw new Error('Ellipse width input missing');
      expect(refreshed.value).toBe('40');
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

  it('names the rotated footprint so the panel and toolbar stop looking contradictory', async () => {
    // Audit finding: the panel shows the shape's own (unrotated) size while
    // the toolbar shows the rotated axis-aligned bounds — both correct, both
    // unlabeled. A rotated shape now carries a note with the toolbar's exact
    // footprint numbers; an unrotated shape shows no note.
    const ellipse = createEllipse({
      id: 'ellipse-rotated',
      color: '#ff0000',
      spec: { widthMm: 40, heightMm: 20 },
    });
    const view = await renderShape(ellipse);
    try {
      expect(view.host.querySelector('[role="note"]')).toBeNull();
      await act(async () => {
        useStore.setState((s) => ({
          project: {
            ...s.project,
            scene: {
              ...s.project.scene,
              objects: s.project.scene.objects.map((object) =>
                object.id === 'ellipse-rotated' && object.kind === 'shape'
                  ? { ...object, transform: { ...object.transform, rotationDeg: 45 } }
                  : object,
              ),
            },
          },
        }));
      });
      const note = view.host.querySelector('[role="note"]');
      expect(note).not.toBeNull();
      expect(note?.textContent).toContain('Rotated footprint');
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
