import type { Toolpath } from '../../core/job';
import type { ViewTransform } from './view-transform';

export type FrameKey = {
  readonly route: Toolpath;
  readonly scrubberT: number;
  readonly showTravel: boolean;
};
export type Target = {
  readonly key: FrameKey;
  readonly backgroundKey: object;
  readonly view: ViewTransform;
  readonly width: number;
  readonly height: number;
};
export type Painted = { readonly bitmap: ImageBitmap; readonly target: Target };

export function frameKey(
  previous: FrameKey | undefined,
  route: Toolpath,
  scrubberT: number,
  showTravel: boolean,
): FrameKey {
  return previous !== undefined &&
    previous.route === route &&
    previous.scrubberT === scrubberT &&
    previous.showTravel === showTravel
    ? previous
    : { route, scrubberT, showTravel };
}

export function sameContent(a: Target, b: Target): boolean {
  // Playback can advance before every worker reply. Its latest completed
  // progress remains a useful interim image of this same route and background.
  return (
    a.key.route === b.key.route &&
    a.key.showTravel === b.key.showTravel &&
    a.backgroundKey === b.backgroundKey
  );
}

export function paintMatchesTarget(painted: Painted | null, target: Target | null): boolean {
  if (painted === null || target === null) return false;
  const previous = painted.target;
  return (
    sameContent(previous, target) &&
    previous.key.scrubberT === target.key.scrubberT &&
    previous.width === target.width &&
    previous.height === target.height &&
    previous.view.scale === target.view.scale &&
    previous.view.offsetX === target.view.offsetX &&
    previous.view.offsetY === target.view.offsetY
  );
}

export function drawTransformedBitmap(
  ctx: CanvasRenderingContext2D,
  painted: Painted,
  view: ViewTransform,
): void {
  const previous = painted.target.view;
  const ratio = view.scale / previous.scale;
  const exactView =
    previous.scale === view.scale &&
    previous.offsetX === view.offsetX &&
    previous.offsetY === view.offsetY &&
    painted.target.width === ctx.canvas.width &&
    painted.target.height === ctx.canvas.height;
  ctx.save();
  // The worker already painted over the actual underlay. Copy an exact frame
  // instead of blending its translucent pixels a second time.
  if (exactView) ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(
    painted.bitmap,
    view.offsetX - previous.offsetX * ratio,
    view.offsetY - previous.offsetY * ratio,
    painted.target.width * ratio,
    painted.target.height * ratio,
  );
  ctx.restore();
}
