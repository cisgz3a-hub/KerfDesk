// Live preview for the Offset Shapes dialog (ADR-410): the selection in grey,
// the outward result in the accent colour and the inward result in green, all
// in world millimetres, so the user sees the offset before anything is added.

import { useMemo } from 'react';
import { materializeVectorObject, type VectorSceneObject } from '../../core/geometry';
import type { OffsetShapesResult } from '../../core/geometry/offset-shapes';
import type { ColoredPath } from '../../core/scene';

const PREVIEW_WIDTH = 280;
const PREVIEW_HEIGHT = 170;
const MARGIN_RATIO = 0.08;
const MIN_SPAN_MM = 1;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function OffsetShapesPreview(props: {
  readonly sources: ReadonlyArray<VectorSceneObject>;
  readonly result: OffsetShapesResult | null;
}): JSX.Element | null {
  // The selection only changes when the dialog's scene does, not per keystroke.
  const sourcePaths = useMemo(() => props.sources.flatMap(worldPaths), [props.sources]);
  const outwardPaths = props.result?.outward?.paths ?? [];
  const inwardPaths = props.result?.inward?.paths ?? [];
  const box = boundsOf([...sourcePaths, ...outwardPaths, ...inwardPaths]);
  if (box === null) return null;
  const spanX = Math.max(box.maxX - box.minX, MIN_SPAN_MM);
  const spanY = Math.max(box.maxY - box.minY, MIN_SPAN_MM);
  const margin = Math.max(spanX, spanY) * MARGIN_RATIO;
  const viewBox = [box.minX - margin, box.minY - margin, spanX + 2 * margin, spanY + 2 * margin];
  return (
    <svg
      role="img"
      aria-label="Offset preview"
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      viewBox={viewBox.join(' ')}
      preserveAspectRatio="xMidYMid meet"
      style={previewStyle}
    >
      <PathSet paths={sourcePaths} stroke="var(--lf-text-faint)" testId="offset-preview-source" />
      <PathSet paths={outwardPaths} stroke="var(--lf-accent)" testId="offset-preview-out" />
      <PathSet paths={inwardPaths} stroke="var(--lf-success)" testId="offset-preview-in" />
    </svg>
  );
}

function PathSet(props: {
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly stroke: string;
  readonly testId: string;
}): JSX.Element | null {
  const d = props.paths
    .flatMap((path) => path.polylines)
    .map((polyline) => {
      const [head, ...rest] = polyline.points;
      if (head === undefined) return '';
      const tail = rest.map((point) => `L${point.x} ${point.y}`).join('');
      return `M${head.x} ${head.y}${tail}${polyline.closed ? 'Z' : ''}`;
    })
    .join('');
  if (d === '') return null;
  return (
    <path
      data-testid={props.testId}
      d={d}
      fill="none"
      stroke={props.stroke}
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function worldPaths(object: VectorSceneObject): ReadonlyArray<ColoredPath> {
  try {
    return materializeVectorObject(object).paths;
  } catch {
    return [];
  }
}

function boundsOf(paths: ReadonlyArray<ColoredPath>): Box | null {
  let box: Box | null = null;
  for (const path of paths) {
    for (const polyline of path.polylines) {
      for (const point of polyline.points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        box =
          box === null
            ? { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
            : {
                minX: Math.min(box.minX, point.x),
                minY: Math.min(box.minY, point.y),
                maxX: Math.max(box.maxX, point.x),
                maxY: Math.max(box.maxY, point.y),
              };
      }
    }
  }
  return box;
}

const previewStyle: React.CSSProperties = {
  display: 'block',
  margin: '0 auto',
  background: 'var(--lf-bg-canvas)',
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-sm)',
};
