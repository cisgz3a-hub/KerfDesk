/** Geometry-only admission for fixed framebuffer coordinates. No colour selection. */
export type Point3 = readonly [number, number, number];
export interface Point2 {
  readonly x: number;
  readonly y: number;
}
export type Pixel = readonly [number, number];
export type Viewport = readonly [number, number, number, number];
type Point4 = readonly [number, number, number, number];

export interface UploadedProjection {
  readonly modelViewMatrix: readonly number[];
  readonly projectionMatrix: readonly number[];
  readonly physicalViewport: Viewport;
  readonly logicalViewport: Viewport;
  readonly framebuffer: readonly [number, number];
}

function multiply(matrix: readonly number[], point: Point4): Point4 {
  if (matrix.length !== 16 || point.length !== 4) throw new Error('Invalid projection input');
  const rowValue = (row: number): number =>
    [0, 1, 2, 3].reduce((sum, column) => {
      const coefficient = matrix[column * 4 + row];
      const coordinate = point[column];
      if (coefficient === undefined || coordinate === undefined)
        throw new Error('Missing projection coefficient or coordinate');
      return sum + coefficient * coordinate;
    }, 0);
  return [rowValue(0), rowValue(1), rowValue(2), rowValue(3)];
}

/** Use the uploaded Float32 matrices, not camera.project on double-precision matrices. */
export function projectUploaded(draw: UploadedProjection, point: Point3): Point2 {
  const eye = multiply(draw.modelViewMatrix, [...point, 1]);
  const clip = multiply(draw.projectionMatrix, eye);
  const [x, y, z, w] = clip;
  if (!clip.every(Number.isFinite) || w <= 0 || Math.abs(z) > w)
    throw new Error('Witness endpoint is behind the camera or outside the depth interval');
  const [left, bottom, width, height] = draw.physicalViewport;
  return {
    x: left + ((x / w + 1) * width) / 2,
    // Stored witness coordinates are screenshot top-left pixels; GL uses bottom-left.
    y: draw.framebuffer[1] - (bottom + ((y / w + 1) * height) / 2),
  };
}

export function pixelScale(draw: UploadedProjection): readonly [number, number] {
  const scale: [number, number] = [
    draw.physicalViewport[2] / draw.logicalViewport[2],
    draw.physicalViewport[3] / draw.logicalViewport[3],
  ];
  if (!scale.every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Invalid logical/current viewport scale');
  return scale;
}

function segmentDistance(point: Point2, start: Point2, end: Point2) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) throw new Error('Admission needs a nonzero projected stroke');
  const fraction = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, fraction));
  return {
    fraction,
    distance: Math.hypot(point.x - start.x - clamped * dx, point.y - start.y - clamped * dy),
  };
}

/** All four corners inside the rounded stroke (body union round endpoint discs). */
export function roundStrokeCoverage(
  draw: UploadedProjection,
  pixel: Pixel,
  start: Point3,
  end: Point3,
  widthCSS: number,
) {
  const scale = pixelScale(draw);
  const toCSS = (point: Point2): Point2 => ({ x: point.x / scale[0], y: point.y / scale[1] });
  const a = toCSS(projectUploaded(draw, start));
  const b = toCSS(projectUploaded(draw, end));
  const [x, y] = pixel;
  const cornerPixels: Pixel[] = [
    [x, y],
    [x + 1, y],
    [x, y + 1],
    [x + 1, y + 1],
  ];
  const corners = cornerPixels.map(([px, py]) => segmentDistance(toCSS({ x: px, y: py }), a, b));
  const centre = toCSS({ x: x + 0.5, y: y + 0.5 });
  const radiusCSS = widthCSS / 2;
  // Keep the primary receipt's 0.1 CSS pixel margin, including at DPR2.
  const marginCSS = 0.1;
  const inBounds =
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x + 1 <= draw.framebuffer[0] &&
    y + 1 <= draw.framebuffer[1];
  const maxCornerDistanceCSS = Math.max(...corners.map((corner) => corner.distance));
  return {
    inBounds,
    radiusCSS,
    marginCSS,
    maxCornerDistanceCSS,
    cornerDistancesCSS: corners.map((corner) => corner.distance),
    cornerFractions: corners.map((corner) => corner.fraction),
    centreFraction: segmentDistance(centre, a, b).fraction,
    centreDistanceCSS: segmentDistance(centre, a, b).distance,
    distanceFromTipCSS: Math.hypot(centre.x - b.x, centre.y - b.y),
    admitted: inBounds && maxCornerDistanceCSS < radiusCSS - marginCSS,
    projectedStart: projectUploaded(draw, start),
    projectedEnd: projectUploaded(draw, end),
    scale,
  };
}

/** DPR2 subdivides the recorded DPR1 box; it never relocates it to a colour match. */
export function fixedWitnessPixels(kind: 'cap' | 'future', dpr: 1 | 2): Pixel[] {
  const primary: Pixel = kind === 'cap' ? [401, 299] : [313, 273];
  const [x, y] = primary;
  if (dpr === 1) return [[x, y]];
  return [
    [x * 2, y * 2],
    [x * 2 + 1, y * 2],
    [x * 2, y * 2 + 1],
    [x * 2 + 1, y * 2 + 1],
  ];
}
