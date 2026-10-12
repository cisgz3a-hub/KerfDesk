// Measure tool at rest (LightBurn Measure): settle the pointer on artwork to
// read the segment under it (line length and angle, arc centre and radius,
// curve length) and the whole outline (perimeter, enclosed area, open paths).
// Display only, like the hover size readout; dragging still measures a distance.

import { useEffect, useState } from 'react';
import { nearestCurveSegment } from '../../core/geometry/curve-segment-edit';
import {
  measureOutline,
  measureSegment,
  type OutlineMeasure,
  type SegmentMeasure,
} from '../../core/geometry/outline-measure';
import {
  artworkOperationName,
  polylineToCurveSubpath,
  sceneLayerVisibility,
  type Project,
  type Scene,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState } from './view-transform';

const DWELL_MS = 140;
const HIT_RADIUS_PX = 8;

export type MeasureHover = {
  readonly name: string;
  readonly point: Vec2;
  readonly segment: SegmentMeasure | null;
  readonly outline: OutlineMeasure;
};

/** The top-most visible artwork outline near `point`, measured. */
export function measureAtPoint(scene: Scene, point: Vec2, radiusMm: number): MeasureHover | null {
  const layers = sceneLayerVisibility.lookup(scene.layers);
  for (let index = scene.objects.length - 1; index >= 0; index -= 1) {
    const object = scene.objects[index];
    if (object === undefined || !('paths' in object)) continue;
    if (!sceneLayerVisibility.hasObject(object, layers)) continue;
    let segment: SegmentMeasure | null = null;
    let best = radiusMm;
    for (const path of object.paths) {
      for (const curve of path.curves ?? path.polylines.map(polylineToCurveSubpath)) {
        const hit = nearestCurveSegment(curve, object.transform, point);
        if (hit === null || hit.distance > best) continue;
        best = hit.distance;
        segment = measureSegment(curve, hit.segmentIndex, object.transform);
      }
    }
    if (segment !== null) {
      return {
        name: artworkOperationName(object),
        point,
        segment,
        outline: measureOutline(object.paths, object.transform),
      };
    }
  }
  return null;
}

export function measureHoverLines(hover: MeasureHover): ReadonlyArray<string> {
  const { outline, segment } = hover;
  const lines = segment === null ? [] : [segmentLine(segment)];
  lines.push(`Perimeter ${mm(outline.perimeterMm)} mm`);
  if (outline.areaMm2 !== null) lines.push(`Area ${mm(outline.areaMm2)} mm²`);
  if (outline.openContours > 0) {
    lines.push(
      `${outline.openContours} open path${outline.openContours === 1 ? '' : 's'}, no area`,
    );
  }
  return lines;
}

function segmentLine(segment: SegmentMeasure): string {
  switch (segment.kind) {
    case 'line':
      return `Line ${mm(segment.lengthMm)} mm at ${segment.angleDeg.toFixed(1)}°`;
    case 'curve':
      return `Curve ${mm(segment.lengthMm)} mm`;
    case 'arc':
      return segment.radiusMm === null
        ? `Elliptical arc ${mm(segment.lengthMm)} mm, centre ${point(segment.center)}`
        : `Arc R ${mm(segment.radiusMm)} mm, ${mm(segment.lengthMm)} mm long, centre ${point(segment.center)}`;
  }
}

function mm(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

function point(value: Vec2): string {
  return `(${mm(value.x)}, ${mm(value.y)})`;
}

export function MeasureHoverReadout(props: {
  readonly project: Project;
  readonly canvasSize: CanvasBitmapSize;
  readonly viewState: ViewState;
  readonly enabled: boolean;
}): JSX.Element | null {
  const cursor = useStore((state) => state.cursorMm);
  const view = computeView(
    props.canvasSize.width,
    props.canvasSize.height,
    props.project.device.bedWidth,
    props.project.device.bedHeight,
    props.viewState,
  );
  const radiusMm = view.scale > 0 ? HIT_RADIUS_PX / view.scale : 0;
  const hover = useDwellMeasure(props.enabled ? cursor : null, props.project.scene, radiusMm);
  if (hover === null) return null;
  return (
    <div
      className="lf-chip"
      aria-hidden="true"
      style={{
        position: 'absolute',
        zIndex: 6,
        display: 'grid',
        gap: 1,
        padding: '5px 8px',
        pointerEvents: 'none',
        boxShadow: 'var(--lf-shadow)',
        fontSize: 'var(--lf-text-sm)',
        left: view.offsetX + hover.point.x * view.scale + 14,
        top: view.offsetY + hover.point.y * view.scale + 16,
      }}
    >
      <strong>{hover.name}</strong>
      {measureHoverLines(hover).map((line) => (
        <span key={line} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
          {line}
        </span>
      ))}
    </div>
  );
}

function useDwellMeasure(cursor: Vec2 | null, scene: Scene, radiusMm: number): MeasureHover | null {
  const [hover, setHover] = useState<MeasureHover | null>(null);
  const x = cursor?.x ?? null;
  const y = cursor?.y ?? null;
  useEffect(() => {
    setHover(null);
    if (x === null || y === null) return;
    const timer = setTimeout(() => setHover(measureAtPoint(scene, { x, y }, radiusMm)), DWELL_MS);
    return () => clearTimeout(timer);
  }, [x, y, scene, radiusMm]);
  return hover;
}
