import type { DeviceProfile, NoGoZone } from '../../core/devices';
import { toSceneCoords } from '../../core/devices';
import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

export function drawNoGoZones(
  ctx: CanvasRenderingContext2D,
  device: DeviceProfile,
  view: ViewTransform,
): void {
  const zones = device.noGoZones ?? [];
  for (const zone of zones) {
    if (!zone.enabled) continue;
    drawZone(ctx, device, view, zone);
  }
}

function drawZone(
  ctx: CanvasRenderingContext2D,
  device: DeviceProfile,
  view: ViewTransform,
  zone: NoGoZone,
): void {
  const a = toSceneCoords({ x: zone.x, y: zone.y }, device);
  const b = toSceneCoords({ x: zone.x + zone.width, y: zone.y + zone.height }, device);
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);
  ctx.save();
  ctx.fillStyle = canvasTheme.noGoZoneFill;
  ctx.strokeStyle = canvasTheme.noGoZoneStroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.fillRect(view.offsetX + minX * view.scale, view.offsetY + minY * view.scale, width * view.scale, height * view.scale);
  ctx.strokeRect(view.offsetX + minX * view.scale, view.offsetY + minY * view.scale, width * view.scale, height * view.scale);
  ctx.restore();
}
