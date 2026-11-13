// The registration bores a tiled CNC save will drill, shown in Preview before
// anything is saved (N4-P1-1). Tiling places them clear of every toolpath,
// outside every outline the toolpaths go round, and on the stock; Preview draws the same positions, in the registration
// layer's purple, and lists them with any seam that got too few. Built beside
// the route, like the CNC fallback notices, so it crosses from the
// preparation worker in the route's header.

import { plannedTileRegistration } from '../../core/cnc/tile-jobs';
import { toSceneCoords } from '../../core/devices';
import type { Job, Toolpath } from '../../core/job';
import type { Project, Vec2 } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

const MIN_HOLE_RADIUS_PX = 3;
const HOLE_STROKE_PX = 1.5;

export type PreviewTileRegistration = {
  /** Bore centres in scene coordinates. */
  readonly holes: ReadonlyArray<Vec2>;
  readonly diameterMm: number;
  readonly notices: ReadonlyArray<string>;
};

type Carrier = { readonly cncTileRegistration?: PreviewTileRegistration };

/** The route with the planned tile registration bores, or the route itself. */
export function withPreviewTileRegistration<T extends Toolpath>(
  toolpath: T,
  project: Project,
  job: Job,
  jobOriginOffset: Vec2,
): T {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return toolpath;
  const planned = plannedTileRegistration(job, machine);
  if (planned === null) return toolpath;
  const holes = planned.placement.seams
    .flatMap((seam) => seam.holes)
    .map((hole) =>
      toSceneCoords(
        { x: hole.x - jobOriginOffset.x, y: hole.y - jobOriginOffset.y },
        project.device,
      ),
    );
  const summary =
    holes.length === 0
      ? 'Tile registration: no hole fits clear of the parts on any seam.'
      : `Tile registration: ${holes.length} ${holes.length === 1 ? 'hole' : 'holes'} ` +
        `(Ø${Math.round(planned.holeDiameterMm * 100) / 100} mm, purple circles), each ` +
        'clear of every toolpath, outside every outline the toolpaths go round, and on the ' +
        'stock. Check them against your parts and fixture.';
  const registration: PreviewTileRegistration = {
    holes,
    diameterMm: planned.holeDiameterMm,
    notices: [summary, ...planned.placement.warnings],
  };
  return { ...toolpath, cncTileRegistration: registration };
}

export function previewTileRegistrationOf(toolpath: Toolpath): PreviewTileRegistration | null {
  return (toolpath as Carrier).cncTileRegistration ?? null;
}

export function previewTileRegistrationNotices(toolpath: Toolpath): ReadonlyArray<string> {
  return previewTileRegistrationOf(toolpath)?.notices ?? [];
}

/** Draw each planned bore at its true size (never smaller than a dot). */
export function drawPreviewTileRegistration(
  ctx: CanvasRenderingContext2D,
  toolpath: Toolpath,
  view: ViewTransform,
): void {
  const registration = previewTileRegistrationOf(toolpath);
  if (registration === null || registration.holes.length === 0) return;
  const radiusPx = Math.max(MIN_HOLE_RADIUS_PX, (registration.diameterMm / 2) * view.scale);
  ctx.save();
  ctx.fillStyle = canvasTheme.previewRegistrationHoleFill;
  ctx.strokeStyle = canvasTheme.previewRegistrationHoleStroke;
  ctx.lineWidth = HOLE_STROKE_PX;
  for (const hole of registration.holes) {
    ctx.beginPath();
    ctx.arc(
      view.offsetX + hole.x * view.scale,
      view.offsetY + hole.y * view.scale,
      radiusPx,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
