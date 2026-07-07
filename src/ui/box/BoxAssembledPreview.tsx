// BoxAssembledPreview — Canvas2D isometric projection of the generated box
// in its assembled positions (ADR-119): every part's local rings mapped
// through its 3D frame, extruded plates painter-sorted far-to-near,
// even-odd fill so cutouts read as holes. Deliberately not three.js: a
// dialog preview needs no camera and must render under jsdom guards.

import { useEffect, useRef } from 'react';
import { framePoint, partFrame, type BoxPanel, type BoxSpec } from '../../core/box';

const PREVIEW_WIDTH_PX = 420;
const PREVIEW_HEIGHT_PX = 220;
const PREVIEW_MARGIN_PX = 12;
const ISO_COS = Math.cos(Math.PI / 6);
const ISO_SIN = Math.sin(Math.PI / 6);

/* eslint-disable no-restricted-syntax -- deliberate light-surface literals
   (always-light assembled-preview canvas, ADR-047 exception). */
const SHEET_BACKGROUND = '#ffffff';
const PLATE_STROKE = '#1a1a1a';
const PLATE_FILL = 'rgba(120, 144, 156, 0.35)';
/* eslint-enable no-restricted-syntax */

export function BoxAssembledPreview(props: {
  readonly panels: ReadonlyArray<BoxPanel> | null;
  readonly spec: BoxSpec | null;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = context2d(canvas);
    if (ctx === null) return;
    drawAssembly(ctx, props.panels, props.spec);
  }, [props.panels, props.spec]);
  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_WIDTH_PX}
      height={PREVIEW_HEIGHT_PX}
      role="img"
      aria-label="Assembled box preview"
      style={{ width: '100%', border: '1px solid var(--lf-border)', borderRadius: 4 }}
    />
  );
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

type Projected = { readonly sx: number; readonly sy: number };

function project(x: number, y: number, z: number): Projected {
  return { sx: (x - y) * ISO_COS, sy: (x + y) * ISO_SIN - z };
}

function drawAssembly(
  ctx: CanvasRenderingContext2D,
  panels: ReadonlyArray<BoxPanel> | null,
  spec: BoxSpec | null,
): void {
  ctx.fillStyle = SHEET_BACKGROUND;
  ctx.fillRect(0, 0, PREVIEW_WIDTH_PX, PREVIEW_HEIGHT_PX);
  if (panels === null || spec === null || panels.length === 0) return;
  const plates = panels
    .map((panel) => plateOf(panel, spec))
    .filter((plate): plate is Plate => plate !== null)
    // Painter sort: far (small x+y+z) first for the (1,1,1)-ish iso view.
    .sort((a, b) => a.depth - b.depth);
  const all = plates.flatMap((plate) => plate.rings.flat());
  const minX = Math.min(...all.map((p) => p.sx));
  const maxX = Math.max(...all.map((p) => p.sx));
  const minY = Math.min(...all.map((p) => p.sy));
  const maxY = Math.max(...all.map((p) => p.sy));
  const scale = Math.min(
    (PREVIEW_WIDTH_PX - 2 * PREVIEW_MARGIN_PX) / Math.max(maxX - minX, 1),
    (PREVIEW_HEIGHT_PX - 2 * PREVIEW_MARGIN_PX) / Math.max(maxY - minY, 1),
  );
  const toCanvas = (p: Projected): [number, number] => [
    PREVIEW_MARGIN_PX + (p.sx - minX) * scale,
    PREVIEW_HEIGHT_PX - PREVIEW_MARGIN_PX - (maxY - p.sy) * scale,
  ];
  ctx.strokeStyle = PLATE_STROKE;
  ctx.lineWidth = 1;
  for (const plate of plates) {
    const path = new Path2D();
    for (const ring of plate.rings) {
      ring.forEach((p, index) => {
        const [cx, cy] = toCanvas(p);
        if (index === 0) path.moveTo(cx, cy);
        else path.lineTo(cx, cy);
      });
    }
    ctx.fillStyle = PLATE_FILL;
    ctx.fill(path, 'evenodd');
    ctx.stroke(path);
  }
}

type Plate = { readonly rings: ReadonlyArray<ReadonlyArray<Projected>>; readonly depth: number };

// One plate = the panel's outer-surface face (local rings at plate depth T,
// mapped through the frame and projected). Sheet points carry the layout
// offset; subtract it to recover the local frame.
function plateOf(panel: BoxPanel, spec: BoxSpec): Plate | null {
  const frame = partFrame(panel, spec);
  if (frame === null) return null;
  let depthSum = 0;
  let depthCount = 0;
  const rings = [panel.outline, ...panel.cutouts].map((ring) =>
    ring.points.map((point) => {
      const world = framePoint(
        frame,
        point.x - panel.offsetMm.x,
        point.y - panel.offsetMm.y,
        frame.thicknessMm,
      );
      depthSum += world.x + world.y + world.z;
      depthCount += 1;
      return project(world.x, world.y, world.z);
    }),
  );
  return { rings, depth: depthCount === 0 ? 0 : depthSum / depthCount };
}
