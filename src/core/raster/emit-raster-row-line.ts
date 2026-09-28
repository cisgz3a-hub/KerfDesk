// Where a raster row's scan-frame positions land on the controller (ADR-492).
//
// The sweep planner and emitter work along the row in the scan frame: one X
// per move. Along X that X is the machine X and the row's Y stays modal, so a
// burn move writes only its X word, exactly as it always has. At a scan angle
// every scan-frame X is a machine point with both coordinates, rounded to the
// controller's three-decimal grid on each axis, and a move writes both words
// (the modal writer still holds an axis that does not change).

import type { Vec2 } from '../scene';
import type { ModalMotionWriter } from '../gcode/motion-words';
import { rasterControllerCoordinateMm } from './raster-sweep-plan';
import { isAlongXScan, scanToMachine, type RasterScanFrame } from './raster-scan-frame';

/** A head position on the controller's three-decimal grid (RasterControllerHead). */
type ControllerHead = { readonly x: number; readonly y: number };

export type RasterRowLine = {
  /** Machine point of scan-frame x on this row. */
  readonly point: (x: number) => Vec2;
  /** That point on the controller's three-decimal grid. */
  readonly head: (x: number) => ControllerHead;
  /**
   * Scan-frame x as the head position the sweep remembers: rounded to the
   * controller grid along X (so the historical arithmetic is unchanged),
   * unrounded at an angle, where the grid is applied per machine axis.
   */
  readonly scanX: (x: number) => number;
  /** The axis words of a move to scan-frame x; the writer holds unchanged ones. */
  readonly axisWords: (writer: ModalMotionWriter, x: number) => ReadonlyArray<string>;
};

export function rasterRowLine(frame: RasterScanFrame, worldY: number): RasterRowLine {
  if (isAlongXScan(frame)) {
    const controllerY = rasterControllerCoordinateMm(worldY);
    return {
      point: (x) => ({ x, y: worldY }),
      head: (x) => ({ x: rasterControllerCoordinateMm(x), y: controllerY }),
      scanX: rasterControllerCoordinateMm,
      axisWords: (writer, x) => [writer.axis('X', x)],
    };
  }
  const point = (x: number): Vec2 => scanToMachine(frame, { x, y: worldY });
  return {
    point,
    head: (x) => {
      const p = point(x);
      return { x: rasterControllerCoordinateMm(p.x), y: rasterControllerCoordinateMm(p.y) };
    },
    scanX: (x) => x,
    axisWords: (writer, x) => {
      const p = point(x);
      return [writer.axis('X', p.x), writer.axis('Y', p.y)];
    },
  };
}

export function sameRasterHead(a: ControllerHead, b: ControllerHead): boolean {
  return a.x === b.x && a.y === b.y;
}
