// The Inspector's measure tool (ADR-470). While it is on, a click on a move
// sets the first point and the next click the second; a third click starts
// over. A point snaps to the end of a move when the pointer is near one, and
// between the clicks the line follows the pointer. A new program, or turning
// the tool off, clears the measurement.

import { useEffect, useState, type RefObject } from 'react';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dPick } from '../viewer3d/scene-pick';

type Point3 = Viewer3dPick['point'];

export type MeasureTool = {
  readonly active: boolean;
  readonly toggle: () => void;
  readonly clear: () => void;
  readonly addPoint: (pick: Viewer3dPick) => void;
  /** The move under the pointer, for the line that follows it. */
  readonly hover: (pick: Viewer3dPick | null) => void;
  readonly from: Point3 | null;
  /** The second point, or where the pointer is while it is still to be chosen. */
  readonly to: Point3 | null;
  /** What the next click on a move does. */
  readonly clickHint: string;
};

type Points = { readonly from: Point3 | null; readonly to: Point3 | null; readonly key: unknown };

/** Where a click measures from: the move's end when the pointer snapped to it. */
export function measuredPoint(pick: Viewer3dPick): Point3 {
  return pick.vertex ?? pick.point;
}

export function useMeasure(
  handleRef: RefObject<Viewer3dSceneHandle | null>,
  ready: boolean,
  resetKey: unknown,
): MeasureTool {
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<Points>({ from: null, to: null, key: resetKey });
  const [preview, setPreview] = useState<Point3 | null>(null);
  const current = points.key === resetKey ? points : { from: null, to: null, key: resetKey };
  const choosingSecond = current.from !== null && current.to === null;
  const to = current.to ?? (choosingSecond ? preview : null);
  const from = current.from;
  useEffect(() => {
    if (!ready) return;
    handleRef.current?.setMeasure(active && from !== null ? { from, to } : null);
  }, [handleRef, ready, active, from, to]);
  const clear = (): void => {
    setPoints({ from: null, to: null, key: resetKey });
    setPreview(null);
  };
  return {
    active,
    toggle: () => {
      setActive(!active);
      clear();
    },
    clear,
    addPoint: (pick) => {
      const point = measuredPoint(pick);
      setPreview(null);
      setPoints(
        choosingSecond ? { ...current, to: point } : { from: point, to: null, key: resetKey },
      );
    },
    hover: (pick) => {
      if (active && choosingSecond) setPreview(pick === null ? null : measuredPoint(pick));
    },
    from,
    to,
    clickHint: choosingSecond ? 'Click to measure to here' : 'Click to measure from here',
  };
}
