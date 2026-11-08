// Burn measurements for the white-fill knock-out tests (ADR-686): import an SVG
// through the store, and measure the compiled burn in machine coordinates.
// compileJob segments are in machine coordinates (Y flipped for a front-left
// origin), so scene outlines are mapped with toMachineCoords before comparing.

import { toMachineCoords } from '../core/devices';
import { compileJob } from '../core/job/compile-job';
import { applyTransform, type Project, type SceneObject, type Vec2 } from '../core/scene';
import { parseSvg } from '../io/svg/parse-svg';
import { useStore } from '../ui/state/store';

/** Parse `svgText` and import it through the store, as File > Import does. */
export function importSvg(svgText: string, source = 'logo.svg') {
  const parsed = parseSvg({ svgText, id: 'logo', source });
  if (parsed.fragment === undefined) throw new Error('Missing SVG fragment');
  const objects = parsed.fragment.entries.filter((entry) => entry.kind === 'imported-svg');
  const outcome = useStore
    .getState()
    .importSvgFragment({ source, bounds: parsed.fragment.bounds, objects });
  return { parsed, outcome };
}

/** The white shapes' outlines in machine coordinates, like the compiled burn. */
export function whiteOutlines(project: Project): Vec2[][] {
  return project.scene.objects.flatMap((object: SceneObject) =>
    'paths' in object
      ? object.paths
          .filter((path) => path.color === '#ffffff')
          .flatMap((path) =>
            path.polylines.map((line) =>
              line.points.map((point) =>
                toMachineCoords(applyTransform(point, object.transform), project.device),
              ),
            ),
          )
      : [],
  );
}

export function burnSegments(project: Project): Vec2[][] {
  return compileJob(project.scene, project.device).groups.flatMap((group) =>
    'segments' in group ? group.segments.map((segment) => [...segment.polyline]) : [],
  );
}

export function burnLength(project: Project): number {
  let length = 0;
  for (const line of burnSegments(project))
    for (let index = 1; index < line.length; index += 1)
      length += Math.hypot(
        line[index]!.x - line[index - 1]!.x,
        line[index]!.y - line[index - 1]!.y,
      );
  return length;
}

function inside(point: Vec2, polygon: readonly Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) hit = !hit;
    }
  }
  return hit;
}

function edgeDistance(point: Vec2, polygon: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    );
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}

/** Burned length strictly inside a white shape (0.05 mm clear of its edge). */
export function burnInside(project: Project, outlines: readonly Vec2[][]): number {
  const step = 0.02;
  let length = 0;
  for (const line of burnSegments(project))
    for (let index = 1; index < line.length; index += 1) {
      const a = line[index - 1]!;
      const b = line[index]!;
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      const samples = Math.max(1, Math.ceil(span / step));
      for (let sample = 0; sample < samples; sample += 1) {
        const t = (sample + 0.5) / samples;
        const point = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        if (
          outlines.some((outline) => inside(point, outline) && edgeDistance(point, outline) > 0.05)
        )
          length += span / samples;
      }
    }
  return length;
}
