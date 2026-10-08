import * as three from 'three';

interface Point {
  x: number;
  y: number;
  z: number;
}

/** Choose by geometric distance to the centreline, independently of pixel colours. */
export function strokeCentrePixel(
  camera: three.Camera,
  sample: Point,
  endpoints: readonly Point[],
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const project = (point: Point) => {
    const p = new three.Vector3(point.x, point.y, point.z).project(camera);
    return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
  };
  const p = project(sample);
  const a = project(endpoints[0] ?? sample);
  const b = project(endpoints[endpoints.length - 1] ?? sample);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  let chosen = { x: Math.floor(p.x), y: Math.floor(p.y), width: 1, height: 1 };
  let nearest = Infinity;
  for (let x = Math.floor(p.x) - 1; x <= Math.floor(p.x) + 1; x += 1) {
    for (let y = Math.floor(p.y) - 1; y <= Math.floor(p.y) + 1; y += 1) {
      const distance =
        length === 0
          ? Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y)
          : Math.abs(dx * (y + 0.5 - a.y) - dy * (x + 0.5 - a.x)) / length;
      if (distance < nearest) {
        nearest = distance;
        chosen = { x, y, width: 1, height: 1 };
      }
    }
  }
  return chosen;
}
