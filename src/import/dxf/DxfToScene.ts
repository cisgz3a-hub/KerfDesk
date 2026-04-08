import { type Scene } from '../../core/scene/Scene';
import { type SceneObject, type PathSegment, type Geometry } from '../../core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId, type Point } from '../../core/types';
import { type DxfFile, type DxfEntity, parseDxf, getNum, getAllNums } from './DxfParser';

export function importDxfIntoScene(
  dxfText: string,
  scene: Scene,
  layerId: string
): Scene {
  const dxf: DxfFile = parseDxf(dxfText);
  const objects: SceneObject[] = [];

  for (const entity of dxf.entities) {
    const obj = convertEntity(entity, layerId);
    if (obj) objects.push(obj);
  }

  if (objects.length === 0) return scene;

  return {
    ...scene,
    objects: [...scene.objects, ...objects],
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

function convertEntity(entity: DxfEntity, layerId: string): SceneObject | null {
  switch (entity.type) {
    case 'LINE': return convertLine(entity, layerId);
    case 'CIRCLE': return convertCircle(entity, layerId);
    case 'ARC': return convertArc(entity, layerId);
    case 'ELLIPSE': return convertEllipse(entity, layerId);
    case 'LWPOLYLINE': return convertLwPolyline(entity, layerId);
    case 'POINT': return null; // Skip points
    default: return null;
  }
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
    _bounds: null,
    _worldTransform: null,
  };
}

function convertLine(e: DxfEntity, layerId: string): SceneObject {
  return makeObject(layerId, 'line', 'Line', {
    type: 'line',
    x1: getNum(e, 10),
    y1: getNum(e, 20),
    x2: getNum(e, 11),
    y2: getNum(e, 21),
  });
}

function convertCircle(e: DxfEntity, layerId: string): SceneObject {
  const r = getNum(e, 40);
  return makeObject(layerId, 'ellipse', 'Circle', {
    type: 'ellipse',
    cx: getNum(e, 10),
    cy: getNum(e, 20),
    rx: r,
    ry: r,
  });
}

function convertArc(e: DxfEntity, layerId: string): SceneObject {
  const cx = getNum(e, 10);
  const cy = getNum(e, 20);
  const r = getNum(e, 40);
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

function convertEllipse(e: DxfEntity, layerId: string): SceneObject {
  const cx = getNum(e, 10);
  const cy = getNum(e, 20);
  // Major axis endpoint relative to center
  const mx = getNum(e, 11);
  const my = getNum(e, 21);
  const ratio = getNum(e, 40, 1); // minor/major ratio

  const majorRadius = Math.sqrt(mx * mx + my * my);
  const minorRadius = majorRadius * ratio;

  // For simplicity, treat as axis-aligned ellipse
  // (rotation from major axis direction is ignored for now)
  return makeObject(layerId, 'ellipse', 'Ellipse', {
    type: 'ellipse',
    cx,
    cy,
    rx: majorRadius,
    ry: minorRadius,
  });
}

function convertLwPolyline(e: DxfEntity, layerId: string): SceneObject {
  const xs = getAllNums(e, 10);
  const ys = getAllNums(e, 20);
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
