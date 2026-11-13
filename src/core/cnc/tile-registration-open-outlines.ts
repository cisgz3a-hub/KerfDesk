// Open outlines and the registration bores (ADR-392 Amendment 9, CNC audit v3
// N8-P1-1).
//
// A part drawn as an open outline compiles to a cut whose ends do not meet, so
// its path never goes round a ring and the bore keep-out (ringsOf) never saw
// the part. Bores went through it, even when the tab compiler (ADR-258
// Amendment 7) treats that outline as closed and Job Review says so.
//
// Two rules, both from the outline's own cut:
// - **Effectively closed.** An open cut whose ends lie closer than the tab
//   compiler's limit (`closedForTabsBelowMm`: the cut width plus the sliver
//   that holds less than one tab, at least 0.2 mm) frees what it goes round.
//   It joins the keep-out as a part, closed across its gap.
// - **Genuinely open.** Any other open cut that encloses more than the bit's
//   own footprint is not known as a part. A bore that lands inside it gets a
//   warning that names its layer, its size, its gap and the bore.

import { cncPassXyPoints, type CncGroup, type CncPass, type Job } from '../job';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings, type Layer, type Vec2 } from '../scene';
import { closedForTabsBelowMm } from './cnc-open-outline-tabs';
import { maxOf, minOf } from '../util';
import { ringsOf, signedArea, windsAround } from './tile-registration-rings';

/** The layers a job compiled from, so each cut is judged with its own settings. */
export type RegistrationLayers = ReadonlyArray<Pick<Layer, 'id' | 'name' | 'cnc'>>;

/** An open cut that does not close: a part it may outline is not kept clear. */
export type OpenOutline = {
  readonly layerName: string;
  readonly points: ReadonlyArray<Vec2>;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly gapMm: number;
};

export type OpenOutlineReading = {
  /** Effectively closed outlines, kept clear like parts. */
  readonly closing: ReadonlyArray<ReadonlyArray<Vec2>>;
  readonly open: ReadonlyArray<OpenOutline>;
};

/** Read every open cut of a job as effectively closed or genuinely open. */
export function readOpenOutlines(
  job: Job,
  skipLayerId: string,
  layers: RegistrationLayers = [],
): OpenOutlineReading {
  const closing: Array<ReadonlyArray<Vec2>> = [];
  const open = new Map<string, OpenOutline>();
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || group.layerId === skipLayerId) continue;
    const layer = layers.find((candidate) => candidate.id === group.layerId);
    const limitMm = closedBelowMm(group, layer?.cnc);
    for (const pass of group.passes) {
      const outline = openOutline(pass, group.toolDiameterMm);
      if (outline === null) continue;
      if (outline.gapMm < limitMm) {
        closing.push(outline.points);
        continue;
      }
      const named: OpenOutline = { ...outline, layerName: layer?.name ?? group.layerId };
      open.set(outlineKey(named), named);
    }
  }
  return { closing, open: [...open.values()] };
}

/** One warning per genuinely open outline that a bore lands inside. */
export function openOutlineBoreWarnings(
  open: ReadonlyArray<OpenOutline>,
  bores: ReadonlyArray<Vec2>,
): ReadonlyArray<string> {
  return open.flatMap((outline) => {
    const inside = bores.filter((bore) => windsAround(outline.points, bore));
    if (inside.length === 0) return [];
    const at = inside.map((bore) => `(${mm(bore.x)}, ${mm(bore.y)})`).join(', ');
    const holes =
      inside.length === 1 ? 'A registration hole' : `${inside.length} registration holes`;
    return [
      `${holes} at stock ${at} ${inside.length === 1 ? 'lies' : 'lie'} inside an open outline ` +
        `on layer "${outline.layerName}" (${mm(outline.widthMm)} × ${mm(outline.heightMm)} mm, ` +
        `its ends ${mm(outline.gapMm)} mm apart). Its ends are too far apart for KerfDesk to ` +
        'treat it as a part, so the holes were not kept out of it. If it is a part, close the ' +
        'outline (Tools > Join paths) or turn registration holes off.',
    ];
  });
}

// The tab compiler's limit for this layer (ADR-258 Amendment 7). Without the
// layer, the default tab size and the group's own depth stand in for it.
function closedBelowMm(group: CncGroup, settings: CncLayerSettings | undefined): number {
  const depthMm = settings?.depthMm ?? group.requestedDepthMm ?? deepestCutMm(group);
  return closedForTabsBelowMm(
    { ...DEFAULT_CNC_LAYER_SETTINGS, ...settings, depthMm },
    group.toolDiameterMm,
  );
}

function deepestCutMm(group: CncGroup): number {
  let deepest = 0;
  for (const pass of group.passes) {
    if (pass.kind === 'path3d') {
      for (const point of pass.points) deepest = Math.max(deepest, -point.z);
    } else deepest = Math.max(deepest, -pass.zMm);
  }
  return deepest;
}

// An open cut that encloses more than the bit's own footprint (as
// openOutlineGapMm counts it), with no ring of its own.
function openOutline(pass: CncPass, cutWidthMm: number): Omit<OpenOutline, 'layerName'> | null {
  if (pass.kind === 'helical-contour' || pass.closed) return null;
  const points = cncPassXyPoints(pass);
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 3 || first === undefined || last === undefined) return null;
  if (ringsOf(points).length > 0) return null;
  if (!(Math.abs(signedArea(points)) > cutWidthMm * cutWidthMm)) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    points,
    widthMm: maxOf(xs) - minOf(xs),
    heightMm: maxOf(ys) - minOf(ys),
    gapMm: Math.hypot(last.x - first.x, last.y - first.y),
  };
}

function outlineKey(outline: OpenOutline): string {
  const first = outline.points[0] as Vec2;
  return [
    outline.layerName,
    mm(first.x),
    mm(first.y),
    mm(outline.widthMm),
    mm(outline.heightMm),
  ].join('|');
}

function mm(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
