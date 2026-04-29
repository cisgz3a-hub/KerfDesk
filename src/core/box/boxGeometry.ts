/**
 * Pure box-joinery geometry extracted from the React box generator so the
 * topology can be tested without rendering UI.
 */

export type EdgeMode = 'finger' | 'slot' | 'flat';

export interface BoxFace {
  name: string;
  points: Array<{ x: number; y: number }>;
  offsetX: number;
  offsetY: number;
}

export interface BoxParams {
  width: number;
  height: number;
  depth: number;
  thickness: number;
  fingerWidth: number;
  openTop: boolean;
}

export function generateBoxFaces(params: BoxParams): BoxFace[] {
  const { width, height, depth, thickness: t, fingerWidth: fw, openTop } = params;
  const spacing = t * 2 + 5;
  const sidewallTop: EdgeMode = openTop ? 'flat' : 'slot';
  const row2Y = height + spacing + t;
  const row3Y = row2Y + height + spacing + t;

  const faces: BoxFace[] = [
    {
      name: 'Front',
      points: generateRectWithFingers(width, height, t, fw, sidewallTop, 'slot', 'finger', 'finger'),
      offsetX: t,
      offsetY: t,
    },
    {
      name: 'Back',
      points: generateRectWithFingers(width, height, t, fw, sidewallTop, 'slot', 'finger', 'finger'),
      offsetX: width + spacing + t,
      offsetY: t,
    },
    {
      name: 'Left',
      points: generateRectWithFingers(depth, height, t, fw, sidewallTop, 'slot', 'slot', 'slot'),
      offsetX: t,
      offsetY: row2Y,
    },
    {
      name: 'Right',
      points: generateRectWithFingers(depth, height, t, fw, sidewallTop, 'slot', 'slot', 'slot'),
      offsetX: depth + spacing + t,
      offsetY: row2Y,
    },
    {
      name: 'Bottom',
      points: generateRectWithFingers(width, depth, t, fw, 'finger', 'finger', 'finger', 'finger'),
      offsetX: t,
      offsetY: row3Y,
    },
  ];

  if (!openTop) {
    faces.push({
      name: 'Top',
      points: generateRectWithFingers(width, depth, t, fw, 'finger', 'finger', 'finger', 'finger'),
      offsetX: width + spacing + t,
      offsetY: row3Y,
    });
  }

  return faces;
}

export function generateRectWithFingers(
  w: number,
  h: number,
  t: number,
  fw: number,
  topMode: EdgeMode,
  bottomMode: EdgeMode,
  leftMode: EdgeMode,
  rightMode: EdgeMode,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const countW = Math.max(1, Math.round(w / fw)) | 1;
  const countH = Math.max(1, Math.round(h / fw)) | 1;
  const segW = w / countW;
  const segH = h / countH;

  for (let i = 0; i < countW; i++) {
    const x1 = i * segW;
    const x2 = (i + 1) * segW;
    if (topMode === 'finger' && i % 2 === 0) {
      points.push({ x: x1, y: 0 }, { x: x1, y: -t }, { x: x2, y: -t }, { x: x2, y: 0 });
    } else if (topMode === 'slot' && i % 2 === 0) {
      points.push({ x: x1, y: 0 }, { x: x1, y: t }, { x: x2, y: t }, { x: x2, y: 0 });
    } else {
      points.push({ x: x1, y: 0 }, { x: x2, y: 0 });
    }
  }

  for (let i = 0; i < countH; i++) {
    const y1 = i * segH;
    const y2 = (i + 1) * segH;
    if (rightMode === 'finger' && i % 2 === 0) {
      points.push({ x: w, y: y1 }, { x: w + t, y: y1 }, { x: w + t, y: y2 }, { x: w, y: y2 });
    } else if (rightMode === 'slot' && i % 2 === 0) {
      points.push({ x: w, y: y1 }, { x: w - t, y: y1 }, { x: w - t, y: y2 }, { x: w, y: y2 });
    } else {
      points.push({ x: w, y: y1 }, { x: w, y: y2 });
    }
  }

  for (let i = countW - 1; i >= 0; i--) {
    const x1 = i * segW;
    const x2 = (i + 1) * segW;
    if (bottomMode === 'finger' && i % 2 === 0) {
      points.push({ x: x2, y: h }, { x: x2, y: h + t }, { x: x1, y: h + t }, { x: x1, y: h });
    } else if (bottomMode === 'slot' && i % 2 === 0) {
      points.push({ x: x2, y: h }, { x: x2, y: h - t }, { x: x1, y: h - t }, { x: x1, y: h });
    } else {
      points.push({ x: x2, y: h }, { x: x1, y: h });
    }
  }

  for (let i = countH - 1; i >= 0; i--) {
    const y1 = i * segH;
    const y2 = (i + 1) * segH;
    if (leftMode === 'finger' && i % 2 === 0) {
      points.push({ x: 0, y: y2 }, { x: -t, y: y2 }, { x: -t, y: y1 }, { x: 0, y: y1 });
    } else if (leftMode === 'slot' && i % 2 === 0) {
      points.push({ x: 0, y: y2 }, { x: t, y: y2 }, { x: t, y: y1 }, { x: 0, y: y1 });
    } else {
      points.push({ x: 0, y: y2 }, { x: 0, y: y1 });
    }
  }

  if (points.length === 0) return points;
  const cleaned: Array<{ x: number; y: number }> = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const current = points[i]!;
    const prev = cleaned[cleaned.length - 1]!;
    if (Math.abs(current.x - prev.x) > 0.001 || Math.abs(current.y - prev.y) > 0.001) {
      cleaned.push(current);
    }
  }
  return cleaned;
}
