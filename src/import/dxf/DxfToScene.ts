import { type Scene } from '../../core/scene/Scene';
import { createLayer, type Layer } from '../../core/scene/Layer';
import { type SceneObject, type PathSegment, type Geometry } from '../../core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId, type Point } from '../../core/types';
import { type DxfFile, type DxfEntity, parseDxf, getNum, getAllNums } from './DxfParser';
import { resolveDxfUnitScaleToMm, type DxfUnitMode } from './DxfUnits';

/**
 * Map DXF layer names to LaserForge layer modes.
 * Common DXF conventions:
 *   - "Cut", "CUT", "Outline" → cut
 *   - "Engrave", "ENGRAVE", "Fill", "Etch" → engrave
 *   - "Score", "SCORE", "Mark" → score
 *   - Numbers (0, 1, 2...) → cut for 0, engrave for 1, score for 2
 *   - Everything else → cut
 */
function dxfLayerToMode(layerName: string): 'cut' | 'engrave' | 'score' {
  const name = layerName.toLowerCase().trim();

  if (name.includes('engrav') || name.includes('fill') || name.includes('etch') || name.includes('raster')) return 'engrave';
  if (name.includes('score') || name.includes('mark') || name.includes('line')) return 'score';
  if (name.includes('cut') || name.includes('outline') || name.includes('thru')) return 'cut';

  if (name === '1') return 'engrave';
  if (name === '2') return 'score';

  return 'cut';
}

function getOrCreateDxfLayer(
  layers: Layer[],
  dxfLayerName: string,
): { layers: Layer[]; layerId: string } {
  const existing = layers.find(l => l.name === dxfLayerName);
  if (existing) {
    return { layers, layerId: existing.id };
  }

  const mode = dxfLayerToMode(dxfLayerName);
  const newLayer = createLayer(
    layers.length,
    mode,
    dxfLayerName,
  );

  return {
    layers: [...layers, newLayer],
    layerId: newLayer.id,
  };
}

export function importDxfIntoScene(
  dxfText: string,
  scene: Scene,
  options: { unitMode?: DxfUnitMode | null } = {},
): Scene {
  const dxf: DxfFile = parseDxf(dxfText);
  const scaleToMm = resolveDxfUnitScaleToMm(dxf.units, options.unitMode);
  const newObjects: SceneObject[] = [];

  let currentLayers = [...scene.layers];

  for (const entity of dxf.entities) {
    const dxfLayerName = entity.layer || '0';
    const { layers: updatedLayers, layerId } = getOrCreateDxfLayer(currentLayers, dxfLayerName);
    currentLayers = updatedLayers;

    const obj = convertEntity(entity, layerId, scaleToMm);
    if (obj) newObjects.push(obj);
  }

  if (newObjects.length === 0) return scene;

  return {
    ...scene,
    layers: currentLayers,
    objects: [...scene.objects, ...newObjects],
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

function convertEntity(entity: DxfEntity, layerId: string, scaleToMm: number): SceneObject | null {
  switch (entity.type) {
    case 'LINE': return convertLine(entity, layerId, scaleToMm);
    case 'CIRCLE': return convertCircle(entity, layerId, scaleToMm);
    case 'ARC': return convertArc(entity, layerId, scaleToMm);
    case 'ELLIPSE': return convertEllipse(entity, layerId, scaleToMm);
    case 'LWPOLYLINE': return convertLwPolyline(entity, layerId, scaleToMm);
    case 'POLYLINE': return convertLwPolyline(entity, layerId, scaleToMm);
    case 'POINT': return null; // Skip points
    default: return null;
  }
}

function scaledNum(entity: DxfEntity, code: number, scaleToMm: number, fallback: number = 0): number {
  return getNum(entity, code, fallback) * scaleToMm;
}

function scaledAllNums(entity: DxfEntity, code: number, scaleToMm: number): number[] {
  return getAllNums(entity, code).map(value => value * scaleToMm);
}

function makeObject(layerId: string, type: SceneObject['type'], name: string, geometry: Geometry): SceneObject {
  return {
    id: generateId(),
    type,
    name,
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

function convertLine(e: DxfEntity, layerId: string, scaleToMm: number): SceneObject {
  return makeObject(layerId, 'line', 'Line', {
    type: 'line',
    x1: scaledNum(e, 10, scaleToMm),
    y1: scaledNum(e, 20, scaleToMm),
    x2: scaledNum(e, 11, scaleToMm),
    y2: scaledNum(e, 21, scaleToMm),
  });
}

function convertCircle(e: DxfEntity, layerId: string, scaleToMm: number): SceneObject {
  const r = scaledNum(e, 40, scaleToMm);
  return makeObject(layerId, 'ellipse', 'Circle', {
    type: 'ellipse',
    cx: scaledNum(e, 10, scaleToMm),
    cy: scaledNum(e, 20, scaleToMm),
    rx: r,
    ry: r,
  });
}

function convertArc(e: DxfEntity, layerId: string, scaleToMm: number): SceneObject {
  const cx = scaledNum(e, 10, scaleToMm);
  const cy = scaledNum(e, 20, scaleToMm);
  const r = scaledNum(e, 40, scaleToMm);
  const startDeg = getNum(e, 50);
  const endDeg = getNum(e, 51);

  // Convert arc to path segments
  const startRad = (startDeg * Math.PI) / 180;
  const endRad = (endDeg * Math.PI) / 180;

  // Generate points along the arc
  let sweep = endRad - startRad;
  if (sweep <= 0) sweep += Math.PI * 2;

  const segments = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * 64));
  const points: Point[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = startRad + (i / segments) * sweep;
    points.push({
      x: cx + r * Math.cos(t),
      y: cy + r * Math.sin(t),
    });
  }

  const pathSegments: PathSegment[] = [
    { type: 'move', to: points[0] },
    ...points.slice(1).map(p => ({ type: 'line' as const, to: p })),
  ];

  return makeObject(layerId, 'path', 'Arc', {
    type: 'path',
    subPaths: [{ segments: pathSegments, closed: false }],
  });
}

function convertEllipse(e: DxfEntity, layerId: string, scaleToMm: number): SceneObject {
  const cx = scaledNum(e, 10, scaleToMm);
  const cy = scaledNum(e, 20, scaleToMm);
  // Major axis endpoint relative to center
  const mx = scaledNum(e, 11, scaleToMm);
  const my = scaledNum(e, 21, scaleToMm);
  const ratio = getNum(e, 40, 1); // minor/major ratio

  const majorRadius = Math.sqrt(mx * mx + my * my);
  const minorRadius = majorRadius * ratio;

  const obj = makeObject(layerId, 'ellipse', 'Ellipse', {
    type: 'ellipse',
    cx: 0,
    cy: 0,
    rx: majorRadius,
    ry: minorRadius,
  });

  if (majorRadius < 1e-9) {
    obj.transform = { a: 1, b: 0, c: 0, d: 1, tx: cx, ty: cy };
    return obj;
  }

  const theta = Math.atan2(my, mx);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  obj.transform = { a: cos, b: sin, c: -sin, d: cos, tx: cx, ty: cy };
  return obj;
}

function convertLwPolyline(e: DxfEntity, layerId: string, scaleToMm: number): SceneObject {
  const xs = scaledAllNums(e, 10, scaleToMm);
  const ys = scaledAllNums(e, 20, scaleToMm);
  const bulges = getAllNums(e, 42);
  const closed = getNum(e, 70) === 1;

  if (xs.length < 2) return makeObject(layerId, 'path', 'Polyline', {
    type: 'path',
    subPaths: [],
  });

  const points: Point[] = xs.map((x, i) => ({ x, y: ys[i] || 0 }));

  // Check if any bulge values exist (curved segments)
  const hasBulge = bulges.some(b => Math.abs(b) > 0.0001);

  if (!hasBulge) {
    // Simple polygon/polyline
    return makeObject(layerId, 'polygon', closed ? 'Polygon' : 'Polyline', {
      type: 'polygon',
      points,
      closed,
    });
  }

  // Polyline with arcs (bulge values)
  const segments: PathSegment[] = [{ type: 'move', to: points[0] }];
  const n = closed ? points.length : points.length - 1;

  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const bulge = bulges[i] || 0;

    if (Math.abs(bulge) < 0.0001) {
      segments.push({ type: 'line', to: p2 });
    } else {
      // Convert bulge to arc, approximate with line segments
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const chord = Math.sqrt(dx * dx + dy * dy);
      const sagitta = Math.abs(bulge) * chord / 2;
      const radius = (chord * chord / 4 + sagitta * sagitta) / (2 * sagitta);

      // Midpoint of chord
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;

      // Normal to chord
      const nx = -dy / chord;
      const ny = dx / chord;

      // Center of arc
      const sign = bulge > 0 ? 1 : -1;
      const dist = radius - sagitta;
      const acx = mx + sign * dist * nx;
      const acy = my + sign * dist * ny;

      // Generate arc points
      const startAngle = Math.atan2(p1.y - acy, p1.x - acx);
      const endAngle = Math.atan2(p2.y - acy, p2.x - acx);
      let sweep = endAngle - startAngle;
      if (bulge > 0 && sweep < 0) sweep += Math.PI * 2;
      if (bulge < 0 && sweep > 0) sweep -= Math.PI * 2;

      const arcSegments = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 16)));
      for (let j = 1; j <= arcSegments; j++) {
        const t = startAngle + (j / arcSegments) * sweep;
        segments.push({
          type: 'line',
          to: {
            x: acx + radius * Math.cos(t),
            y: acy + radius * Math.sin(t),
          },
        });
      }
    }
  }

  if (closed) segments.push({ type: 'close' });

  return makeObject(layerId, 'path', 'Polyline', {
    type: 'path',
    subPaths: [{ segments, closed }],
  });
}
