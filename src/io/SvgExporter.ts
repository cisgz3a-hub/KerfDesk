/**
 * Export scene objects to SVG format.
 */
import { type Scene } from '../core/scene/Scene';
import { type SceneObject } from '../core/scene/SceneObject';

export function exportSceneToSvg(scene: Scene): string {
  const w = scene.canvas.width;
  const h = scene.canvas.height;

  let paths = '';

  for (const obj of scene.objects) {
    if (!obj.visible) continue;
    if (obj.geometry.type === 'image') continue; // Skip raster images

    // Use industry-standard colors for laser operations
    const layerColorMap: Record<string, string> = {
      cut: '#ff0000',      // Red = cut through
      engrave: '#0000ff',  // Blue = engrave/raster
      score: '#00ff00',    // Green = score/mark
      image: '#000000',    // Black = image engrave
    };

    const layer = scene.layers.find(l => l.id === obj.layerId);
    const mode = layer?.settings?.mode || 'cut';
    const strokeColor = layerColorMap[mode] || '#000000';
    const t = obj.transform;

    const pathData = objectToSvgPath(obj);
    if (!pathData) continue;

    paths += `  <g transform="matrix(${t.a},${t.b},${t.c},${t.d},${t.tx},${t.ty})">\n`;
    paths += `    <path d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="0.1" data-layer="${mode}" data-power="${layer?.settings?.power?.max || 0}" data-speed="${layer?.settings?.speed || 0}"/>\n`;
    paths += `  </g>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
${paths}</svg>`;
}

function objectToSvgPath(obj: SceneObject): string | null {
  const geom = obj.geometry as any;

  switch (geom.type) {
    case 'rect':
      return `M${geom.x},${geom.y} L${geom.x + geom.width},${geom.y} L${geom.x + geom.width},${geom.y + geom.height} L${geom.x},${geom.y + geom.height} Z`;

    case 'ellipse': {
      const cx = geom.cx, cy = geom.cy, rx = geom.rx, ry = geom.ry;
      return `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`;
    }

    case 'line':
      return `M${geom.x1},${geom.y1} L${geom.x2},${geom.y2}`;

    case 'polygon': {
      if (!geom.points || geom.points.length < 2) return null;
      const pts = geom.points;
      let d = `M${pts[0].x},${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        d += ` L${pts[i].x},${pts[i].y}`;
      }
      if (geom.closed) d += ' Z';
      return d;
    }

    case 'path': {
      if (!geom.subPaths || geom.subPaths.length === 0) return null;
      let d = '';
      for (const sp of geom.subPaths) {
        for (const seg of sp.segments) {
          switch (seg.type) {
            case 'move': d += `M${r(seg.to.x)},${r(seg.to.y)} `; break;
            case 'line': d += `L${r(seg.to.x)},${r(seg.to.y)} `; break;
            case 'quadratic': d += `Q${r(seg.cp.x)},${r(seg.cp.y)} ${r(seg.to.x)},${r(seg.to.y)} `; break;
            case 'cubic': d += `C${r(seg.cp1.x)},${r(seg.cp1.y)} ${r(seg.cp2.x)},${r(seg.cp2.y)} ${r(seg.to.x)},${r(seg.to.y)} `; break;
            case 'close': d += 'Z '; break;
          }
        }
      }
      return d.trim();
    }

    case 'text': {
      // Text can't be a path without font shaping — skip for now
      return null;
    }

    default:
      return null;
  }
}

function r(n: number): string {
  return Number(n.toFixed(3)).toString();
}
