import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ColoredPath, Polyline, Vec2 } from '../../core/scene';

const ARCH_HOUSE_FIXTURE_STEM = 'arch-house-langebaan-source';
const ARCH_HOUSE_FIXTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.json'];
const SMALL_CLOSED_AREA_PX = 4;

export type TraceArtifactMode = 'centerline' | 'edge' | 'filled-contours';

export type TraceArtifactBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type TraceArtifactMetrics = {
  readonly pathCount: number;
  readonly polylineCount: number;
  readonly pointCount: number;
  readonly totalPolylineLength: number;
  readonly openPolylineCount: number;
  readonly closedPolylineCount: number;
  readonly holeCandidateCount: number;
  readonly smallClosedPolylineCount: number;
  readonly bounds: TraceArtifactBounds | null;
};

export type TraceArtifact = {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly mode: TraceArtifactMode;
  readonly source: {
    readonly width: number;
    readonly height: number;
  };
  readonly metrics: TraceArtifactMetrics;
  readonly overlaySvg: string;
};

export type WrittenTraceArtifactEvidence = {
  readonly metricsJsonPath: string;
  readonly overlaySvgPath: string;
};

export type BuildTraceArtifactInput = {
  readonly name: string;
  readonly mode: TraceArtifactMode;
  readonly source: {
    readonly width: number;
    readonly height: number;
  };
  readonly paths: ReadonlyArray<ColoredPath>;
};

export type RequiredTraceFixtureStatus = {
  readonly present: boolean;
  readonly ratingCap: 9 | 10;
  readonly expectedPathGlob: string;
  readonly path: string | null;
};

export function buildTraceArtifact(input: BuildTraceArtifactInput): TraceArtifact {
  const metrics = measureTracePaths(input.paths);
  return {
    schemaVersion: 1,
    name: input.name,
    mode: input.mode,
    source: { width: input.source.width, height: input.source.height },
    metrics,
    overlaySvg: renderTraceOverlaySvg(input, metrics),
  };
}

export function traceArtifactToJson(artifact: TraceArtifact): string {
  const jsonArtifact = {
    schemaVersion: artifact.schemaVersion,
    name: artifact.name,
    mode: artifact.mode,
    source: {
      width: artifact.source.width,
      height: artifact.source.height,
    },
    metrics: {
      pathCount: artifact.metrics.pathCount,
      polylineCount: artifact.metrics.polylineCount,
      pointCount: artifact.metrics.pointCount,
      totalPolylineLength: artifact.metrics.totalPolylineLength,
      openPolylineCount: artifact.metrics.openPolylineCount,
      closedPolylineCount: artifact.metrics.closedPolylineCount,
      holeCandidateCount: artifact.metrics.holeCandidateCount,
      smallClosedPolylineCount: artifact.metrics.smallClosedPolylineCount,
      bounds:
        artifact.metrics.bounds === null
          ? null
          : {
              minX: artifact.metrics.bounds.minX,
              minY: artifact.metrics.bounds.minY,
              maxX: artifact.metrics.bounds.maxX,
              maxY: artifact.metrics.bounds.maxY,
            },
    },
  };
  return `${JSON.stringify(jsonArtifact, null, 2)}\n`;
}

export function writeTraceArtifactEvidence(
  artifact: TraceArtifact,
  outputDir: string,
): WrittenTraceArtifactEvidence {
  mkdirSync(outputDir, { recursive: true });
  const basename = sanitizeArtifactBasename(artifact.name);
  const metricsJsonPath = join(outputDir, `${basename}.metrics.json`);
  const overlaySvgPath = join(outputDir, `${basename}.overlay.svg`);
  writeFileSync(metricsJsonPath, traceArtifactToJson(artifact), 'utf8');
  writeFileSync(overlaySvgPath, artifact.overlaySvg, 'utf8');
  return { metricsJsonPath, overlaySvgPath };
}

export function requiredArchHouseFixtureStatus(
  fixturesDir = join(process.cwd(), 'audit', 'fixtures', 'trace'),
): RequiredTraceFixtureStatus {
  const expectedPathGlob = join(fixturesDir, `${ARCH_HOUSE_FIXTURE_STEM}.*`);
  for (const extension of ARCH_HOUSE_FIXTURE_EXTENSIONS) {
    const path = join(fixturesDir, `${ARCH_HOUSE_FIXTURE_STEM}${extension}`);
    if (existsSync(path)) {
      return { present: true, ratingCap: 10, expectedPathGlob, path };
    }
  }
  return { present: false, ratingCap: 9, expectedPathGlob, path: null };
}

function measureTracePaths(paths: ReadonlyArray<ColoredPath>): TraceArtifactMetrics {
  let polylineCount = 0;
  let pointCount = 0;
  let totalPolylineLength = 0;
  let openPolylineCount = 0;
  let closedPolylineCount = 0;
  const closedPolylines: ClosedPolylineInfo[] = [];
  let bounds: MutableBounds | null = null;
  for (const path of paths) {
    for (const polyline of path.polylines) {
      polylineCount += 1;
      pointCount += polyline.points.length;
      totalPolylineLength += polylineLength(polyline.points);
      if (polyline.closed) {
        closedPolylineCount += 1;
        closedPolylines.push(closedPolylineInfo(polyline));
      } else {
        openPolylineCount += 1;
      }
      bounds = expandBounds(bounds, polyline.points);
    }
  }
  return {
    pathCount: paths.length,
    polylineCount,
    pointCount,
    totalPolylineLength: roundMetric(totalPolylineLength),
    openPolylineCount,
    closedPolylineCount,
    holeCandidateCount: countHoleCandidates(closedPolylines),
    smallClosedPolylineCount: closedPolylines.filter(
      (polyline) => polyline.areaAbs > 0 && polyline.areaAbs <= SMALL_CLOSED_AREA_PX,
    ).length,
    bounds: bounds === null ? null : roundBounds(bounds),
  };
}

function polylineLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a !== undefined && b !== undefined) total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

type ClosedPolylineInfo = {
  readonly points: ReadonlyArray<Vec2>;
  readonly areaAbs: number;
  readonly centroid: Vec2;
};

function closedPolylineInfo(polyline: Polyline): ClosedPolylineInfo {
  const points = finitePoints(polyline.points);
  return {
    points,
    areaAbs: Math.abs(signedArea(points)),
    centroid: centroid(points),
  };
}

function countHoleCandidates(closedPolylines: ReadonlyArray<ClosedPolylineInfo>): number {
  let count = 0;
  for (let i = 0; i < closedPolylines.length; i += 1) {
    const candidate = closedPolylines[i];
    if (candidate === undefined || candidate.points.length < 3) continue;
    const insideLargerContour = closedPolylines.some(
      (other, otherIndex) =>
        otherIndex !== i &&
        other.areaAbs > candidate.areaAbs &&
        pointInPolygon(candidate.centroid, other.points),
    );
    if (insideLargerContour) count += 1;
  }
  return count;
}

function finitePoints(points: ReadonlyArray<Vec2>): Vec2[] {
  return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function centroid(points: ReadonlyArray<Vec2>): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

type MutableBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function expandBounds(
  bounds: MutableBounds | null,
  points: ReadonlyArray<Vec2>,
): MutableBounds | null {
  let next = bounds;
  for (const point of points) {
    if (next === null) {
      next = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
    } else {
      next.minX = Math.min(next.minX, point.x);
      next.minY = Math.min(next.minY, point.y);
      next.maxX = Math.max(next.maxX, point.x);
      next.maxY = Math.max(next.maxY, point.y);
    }
  }
  return next;
}

function roundBounds(bounds: MutableBounds): TraceArtifactBounds {
  return {
    minX: roundMetric(bounds.minX),
    minY: roundMetric(bounds.minY),
    maxX: roundMetric(bounds.maxX),
    maxY: roundMetric(bounds.maxY),
  };
}

function renderTraceOverlaySvg(
  input: BuildTraceArtifactInput,
  metrics: TraceArtifactMetrics,
): string {
  const pathElements = input.paths
    .flatMap((path) => renderColoredPath(path))
    .filter((element) => element.length > 0)
    .join('\n  ');
  const bounds = metrics.bounds;
  const boundsElement =
    bounds === null
      ? ''
      : `\n  <rect x="${bounds.minX}" y="${bounds.minY}" width="${roundMetric(bounds.maxX - bounds.minX)}" height="${roundMetric(bounds.maxY - bounds.minY)}" fill="none" stroke="#2563eb" stroke-dasharray="2 2" stroke-width="0.75" />`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.source.width}" height="${input.source.height}" viewBox="0 0 ${input.source.width} ${input.source.height}" data-trace-artifact="${escapeAttribute(input.name)}" data-trace-mode="${input.mode}">
  <rect x="0" y="0" width="${input.source.width}" height="${input.source.height}" fill="#ffffff" />${boundsElement}
  ${pathElements}
</svg>`;
}

function renderColoredPath(path: ColoredPath): string[] {
  const closedD = path.polylines
    .filter((polyline) => polyline.closed)
    .map(polylineToPathData)
    .filter((d) => d.length > 0)
    .join(' ');
  const open = path.polylines
    .filter((polyline) => !polyline.closed)
    .map((polyline) => renderOpenPolylinePath(polyline, path.color));
  const filled =
    closedD.length === 0
      ? []
      : [
          `<path d="${closedD}" fill="${escapeAttribute(path.color)}" fill-rule="evenodd" stroke="none" />`,
        ];
  return [...filled, ...open];
}

function renderOpenPolylinePath(polyline: Polyline, color: string): string {
  const d = polylineToPathData(polyline);
  if (d.length === 0) return '';
  return `<path d="${d}" fill="none" stroke="${escapeAttribute(color)}" stroke-width="1" vector-effect="non-scaling-stroke" />`;
}

function polylineToPathData(polyline: Polyline): string {
  if (polyline.points.length === 0) return '';
  const first = polyline.points[0];
  if (first === undefined) return '';
  const rest = polyline.points.slice(1);
  const commands = [`M ${formatPoint(first)}`, ...rest.map((point) => `L ${formatPoint(point)}`)];
  if (polyline.closed) commands.push('Z');
  return commands.join(' ');
}

function formatPoint(point: Vec2): string {
  return `${roundMetric(point.x)} ${roundMetric(point.y)}`;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(3));
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function sanitizeArtifactBasename(name: string): string {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean.length > 0 ? clean : 'trace-artifact';
}
