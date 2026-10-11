import { IDENTITY_TRANSFORM, type ShapeObject } from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives/create-ellipse';
import { createPolyline } from '../../core/shapes/create-polyline';
import { DEFAULT_TEXT_COLOR } from '../../core/text';
import type { AppState } from '../state/store';
import type { RemoteWrite } from './types';

type TouchShapeWrite = Extract<RemoteWrite, { command: 'add_polyline' | 'add_ellipse' }>;

/** Uses the same materializers as desktop drawing, in Laser and CNC workspaces (ADR-584). */
export function prepareRemoteShape(_state: AppState, write: TouchShapeWrite): ShapeObject {
  const id = crypto.randomUUID();
  if (write.command === 'add_polyline') {
    return createPolyline({
      id,
      color: DEFAULT_TEXT_COLOR,
      spec: {
        points: write.args.pointsMm.map(({ xMm, yMm }) => ({ x: xMm, y: yMm })),
        closed: write.args.closed,
      },
    });
  }
  return createEllipse({
    id,
    color: DEFAULT_TEXT_COLOR,
    spec: { widthMm: write.args.widthMm, heightMm: write.args.heightMm },
    transform: { ...IDENTITY_TRANSFORM, x: write.args.xMm, y: write.args.yMm },
  });
}
