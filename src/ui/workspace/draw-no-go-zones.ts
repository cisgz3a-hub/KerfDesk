import { toSceneCoords } from '../../core/devices';
import type { Project } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

export function drawNoGoZones(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  for (const zone of project.device.noGoZones) {
    if (!zone.enabled) continue;
    const rect = sceneRectForZone(project, zone);
    ctx.save();
    ctx.fillStyle = canvasTheme.noGoZoneFill;
    ctx.strokeStyle = canvasTheme.outOfBounds;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(
      view.offsetX + rect.x * view.scale,
      view.offsetY + rect.y * view.scale,
      rect.width * view.scale,
      rect.height * view.scale,
    );
    ctx.strokeRect(
      view.offsetX + rect.x * view.scale,
      view.offsetY + rect.y * view.scale,
      rect.width * view.scale,
      rect.height * view.scale,
    );
    ctx.restore();
  }
}

function sceneRectForZone(
  project: Project,
  zone: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const a = toSceneCoords({ x: zone.x, y: zone.y }, project.device);
  const b = toSceneCoords({ x: zone.x + zone.width, y: zone.y + zone.height }, project.device);
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
