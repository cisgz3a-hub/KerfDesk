// Performance audit S4's everyday "mix" design (gen-entry.ts, scene "mix"): a
// grid over 380 x 380 mm of Line circles (32 points) and small Fill rectangles
// with a 0.1 mm hatch, alternating. At 200 objects it emits about 54k lines.
import {
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Polyline,
  type Project,
  type SceneObject,
  type Vec2,
} from '../core/scene';

const LINE = { id: 'L1', color: '#ff0000' };
const FILL = { id: 'L2', color: '#000000' };

export function everydayMixedDesign(objectCount = 200): Project {
  const side = Math.ceil(Math.sqrt(Math.max(1, objectCount)));
  const pitch = 380 / side;
  const objects: SceneObject[] = [];
  for (let index = 0; index < objectCount; index += 1) {
    const cx = 10 + pitch * ((index % side) + 0.5);
    const cy = 10 + pitch * (Math.floor(index / side) + 0.5);
    const asLine = index % 2 === 0;
    const layer = asLine ? LINE : FILL;
    const polyline = asLine
      ? circle(cx, cy, pitch * 0.35, 32)
      : rectangle(cx, cy, pitch * 0.7, pitch * 0.5);
    objects.push({
      kind: 'imported-svg',
      id: `o${index}`,
      source: `o${index}.svg`,
      operationIds: [layer.id],
      bounds: boundsOf(polyline.points),
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: layer.color, polylines: [polyline] }],
    });
  }
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects,
      layers: [
        createLayer({ id: LINE.id, color: LINE.color, mode: 'line', name: 'Cut' }),
        {
          ...createLayer({ id: FILL.id, color: FILL.color, mode: 'fill', name: 'Engrave' }),
          hatchSpacingMm: 0.1,
          speed: 6000,
        },
      ],
    },
  };
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function circle(cx: number, cy: number, radius: number, points: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: points }, (_, index) => ({
      x: round3(cx + radius * Math.cos((index / points) * Math.PI * 2)),
      y: round3(cy + radius * Math.sin((index / points) * Math.PI * 2)),
    })),
  };
}

function rectangle(cx: number, cy: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x: cx - width / 2, y: cy - height / 2 },
      { x: cx + width / 2, y: cy - height / 2 },
      { x: cx + width / 2, y: cy + height / 2 },
      { x: cx - width / 2, y: cy + height / 2 },
    ].map((point) => ({ x: round3(point.x), y: round3(point.y) })),
  };
}

function boundsOf(points: ReadonlyArray<Vec2>) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
