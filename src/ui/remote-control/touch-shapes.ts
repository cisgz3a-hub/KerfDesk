import { IDENTITY_TRANSFORM, type ShapeObject } from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives/create-ellipse';
import { createPolyline } from '../../core/shapes/create-polyline';
import { DEFAULT_TEXT_COLOR } from '../../core/text';
import type { AppState } from '../state/store';
import type { RemoteWrite } from './types';
import { RemoteFault } from './fault';

type TouchShapeWrite = Extract<RemoteWrite, { command: 'add_polyline' | 'add_ellipse' }>;

/** Uses the same materializers as desktop drawing, before the final commit fence. */
export function prepareRemoteShape(state: AppState, write: TouchShapeWrite): ShapeObject {
  if (state.project.machine?.kind === 'cnc') throw new RemoteFault('unsupported_operation');
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
