// Tangent Circle Generator (LightBurn Tools): with exactly three circles
// selected, list every circle tangent to all three and add the chosen one as
// an ordinary drawn circle, in one undo step.

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { objectCircleDiameterMm } from '../../core/geometry/circle-detect';
import {
  tangentCircles,
  type Circle,
  type TangentCircle,
} from '../../core/geometry/tangent-circles';
import { combinedBBox, IDENTITY_TRANSFORM, type Project, type ShapeObject } from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives/create-ellipse';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { selectedObjectIds } from './selection-command-state';
import { currentDrawingColor } from '../workspace/draw-tool';

type TangentCircleDialogState = {
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
};

const useTangentCircleDialogStore = create<TangentCircleDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function openTangentCircleDialog(): void {
  useTangentCircleDialogStore.getState().show();
}

/** The three selected circles, in selection order, or null when the selection is not exactly that. */
export function selectedThreeCircles(
  project: Project,
  ids: ReadonlyArray<string>,
): readonly [Circle, Circle, Circle] | null {
  if (ids.length !== 3) return null;
  const circles = ids.flatMap((id) => {
    const object = project.scene.objects.find((candidate) => candidate.id === id);
    const diameter = object === undefined ? null : objectCircleDiameterMm(object);
    const box = object === undefined ? null : combinedBBox([object]);
    if (diameter === null || box === null) return [];
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    return [{ center, radius: diameter / 2 }];
  });
  const [a, b, c] = circles;
  return a !== undefined && b !== undefined && c !== undefined ? [a, b, c] : null;
}

export function TangentCircleDialogHost(): JSX.Element | null {
  const open = useTangentCircleDialogStore((state) => state.open);
  return open ? <TangentCircleDialog /> : null;
}

function TangentCircleDialog(): JSX.Element {
  const close = useTangentCircleDialogStore((state) => state.close);
  const project = useStore((state) => state.project);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const ids = useMemo(
    () => selectedObjectIds(selectedObjectId, additionalSelectedIds),
    [selectedObjectId, additionalSelectedIds],
  );
  const drawShape = useStore((state) => state.drawShape);
  const solutions = useMemo(() => {
    const circles = selectedThreeCircles(project, ids);
    return circles === null ? [] : tangentCircles(...circles);
  }, [project, ids]);
  const [chosen, setChosen] = useState(0);
  const solution = solutions[chosen];
  return (
    <Dialog
      title="Tangent Circle"
      size="sm"
      onClose={close}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (solution === undefined) return;
        drawShape(tangentCircleShape(solution, currentDrawingColor(project)));
        close();
      }}
    >
      {solutions.length === 0 ? (
        <p>No tangent-circle solutions found for this selection.</p>
      ) : (
        <fieldset>
          <legend>Circles tangent to all three ({solutions.length})</legend>
          {solutions.map((candidate, index) => (
            <label key={`${candidate.center.x},${candidate.center.y},${candidate.radius}`}>
              <input
                title="Choose this tangent circle"
                type="radio"
                name="tangent-circle"
                checked={index === chosen}
                onChange={() => setChosen(index)}
              />{' '}
              {describe(candidate)}
            </label>
          ))}
        </fieldset>
      )}
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={solution === undefined}>
          Add circle
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function describe(circle: TangentCircle): string {
  const enclosed = circle.contact.filter((contact) => contact === 'inside').length;
  const how = enclosed === 0 ? 'outside all' : `internal contact with ${enclosed}`;
  return `Ø ${(circle.radius * 2).toFixed(2)} mm at (${circle.center.x.toFixed(2)}, ${circle.center.y.toFixed(2)}), ${how}`;
}

export function tangentCircleShape(circle: Circle, color: string): ShapeObject {
  const size = circle.radius * 2;
  return createEllipse({
    id: crypto.randomUUID(),
    color,
    spec: { widthMm: size, heightMm: size },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: circle.center.x - circle.radius,
      y: circle.center.y - circle.radius,
    },
  });
}
