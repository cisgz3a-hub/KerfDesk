// slide-lid-panels — the ADR-116 V3 style: bottom and back reuse the
// open-top claim machinery on a surrogate box whose walls rise one extra
// thickness (the captive top strip); left/right get a solid front edge, a
// C-channel notch spliced into it (open at the front, stopping one
// thickness before the back), and keep their strip fingered into the back;
// the front is a butt-jointed short wall with bottom tabs; the lid rides
// the channel band full-width and stops against the back wall. Everything
// is hand-built rectilinear on the shared pattern expressions — exact
// floats, no clipper — so the slide-lid referee can compare bit-for-bit.

import type { Polyline, Vec2 } from '../scene';
import { deriveBoxDims, type BoxSpec } from './box-spec';
import { cellBoundary, edgePattern, primaryOwnsCell } from './edge-pattern';
import { buildPanelClaims, type PanelClaims, type PanelId } from './panel-claims';
import { panelOutline } from './panel-outline';
import type { PanelRings } from './panel-fit';

export type SlideLidPart = {
  readonly name: string;
  readonly panel: PanelId | 'lid';
  readonly rings: PanelRings;
};

export const THUMB_NOTCH_MAX_RADIUS_MM = 8;
const THUMB_NOTCH_SPAN_FRACTION = 4;
const SEMICIRCLE_SEGMENTS = 12;

/** All six slide-lid parts in stable order (walls first, lid last). */
export function buildSlideLidParts(spec: BoxSpec): ReadonlyArray<SlideLidPart> {
  const surrogate = surrogateSpec(spec);
  const claims = buildPanelClaims(surrogate);
  const parts: SlideLidPart[] = [];
  for (const panelClaims of claims) {
    if (panelClaims.panel === 'front') continue;
    if (panelClaims.panel === 'left' || panelClaims.panel === 'right') {
      parts.push({
        name: panelClaims.panel === 'left' ? 'Left' : 'Right',
        panel: panelClaims.panel,
        rings: { outline: channelWall(panelClaims, spec), cutouts: [] },
      });
      continue;
    }
    parts.push({
      name: panelClaims.panel === 'bottom' ? 'Bottom' : 'Back',
      panel: panelClaims.panel,
      rings: { outline: panelOutline(panelClaims), cutouts: [] },
    });
  }
  parts.splice(1, 0, {
    name: 'Front',
    panel: 'front',
    rings: { outline: shortFront(spec), cutouts: [] },
  });
  parts.push({ name: 'Lid', panel: 'lid', rings: { outline: lidPanel(spec), cutouts: [] } });
  return parts;
}

// The open-top surrogate whose walls stand cavity + strip tall; outer mode
// already carries the extra thickness in the entered height.
function surrogateSpec(spec: BoxSpec): BoxSpec {
  return {
    ...spec,
    style: 'open-top',
    heightMm: spec.dimensionMode === 'inner' ? spec.heightMm + spec.thicknessMm : spec.heightMm,
  };
}

// Left/right: solid front edge (the short front butts against it, so every
// front-side cell and the top-front corner belong to the wall), then the
// C-channel spliced into that straight edge. The channel band sits directly
// under the top strip: [OH−2T, OH−T]. It stops one thickness INSIDE the
// wall body (u = OD−2T) — the wall body itself ends at OD−T, so stopping
// there would leave a zero-width neck; the remaining column is the post the
// lid butts against.
function channelWall(claims: PanelClaims, spec: BoxSpec): Polyline {
  const overridden: PanelClaims = {
    ...claims,
    sides: {
      ...claims.sides,
      uMin: claims.sides.uMin.map((interval, index) =>
        index === 0 ? interval : { ...interval, owned: true },
      ),
    },
  };
  const walked = panelOutline(overridden);
  const t = spec.thicknessMm;
  const wallHeight = claims.sizeVMm;
  const channelTop = wallHeight - t;
  const channelBottom = wallHeight - 2 * t;
  const channelEnd = claims.sizeUMm - 2 * t;
  const points = walked.points;
  const spliced: Vec2[] = [];
  let done = false;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p === undefined) continue;
    spliced.push(p);
    const q = points[i + 1];
    if (done || q === undefined) continue;
    if (p.x === 0 && q.x === 0 && p.y > channelTop && q.y < channelBottom) {
      spliced.push({ x: 0, y: channelTop });
      spliced.push({ x: channelEnd, y: channelTop });
      spliced.push({ x: channelEnd, y: channelBottom });
      spliced.push({ x: 0, y: channelBottom });
      done = true;
    }
  }
  return { closed: true, points: spliced };
}

// Short front: butt-jointed sides, bottom tabs on the shared x-pattern
// (front owns the odd cells against the bottom), flat top at the channel
// floor so the lid slides over it.
function shortFront(spec: BoxSpec): Polyline {
  const dims = deriveBoxDims(spec);
  const t = spec.thicknessMm;
  const topMm = t + dims.innerHeightMm;
  const pattern = edgePattern({
    fullSpanMm: dims.outerWidthMm,
    thicknessMm: t,
    targetFingerWidthMm: spec.targetFingerWidthMm,
  });
  const points: Vec2[] = [{ x: pattern.interiorStartMm, y: t }];
  for (let i = 0; i < pattern.cellCount; i += 1) {
    const depth = primaryOwnsCell(i) ? t : 0;
    points.push({ x: cellBoundary(pattern, i), y: depth });
    points.push({ x: cellBoundary(pattern, i + 1), y: depth });
  }
  points.push({ x: pattern.interiorEndMm, y: topMm });
  points.push({ x: pattern.interiorStartMm, y: topMm });
  points.push({ x: pattern.interiorStartMm, y: t });
  return { closed: true, points: cleanRing(points) };
}

// Full-width lid: rides through both wall channels, stops against the
// channel post, thumb notch centered on the leading edge.
function lidPanel(spec: BoxSpec): Polyline {
  const dims = deriveBoxDims(spec);
  const lengthMm = dims.outerDepthMm - 2 * spec.thicknessMm;
  const radiusMm = Math.min(
    THUMB_NOTCH_MAX_RADIUS_MM,
    dims.innerWidthMm / THUMB_NOTCH_SPAN_FRACTION,
  );
  const centerX = dims.outerWidthMm / 2;
  const points: Vec2[] = [{ x: 0, y: 0 }];
  for (let i = 0; i <= SEMICIRCLE_SEGMENTS; i += 1) {
    const angle = Math.PI - (i / SEMICIRCLE_SEGMENTS) * Math.PI;
    // sin(π) carries float dust; the notch endpoints sit ON the edge.
    const onEdge = i === 0 || i === SEMICIRCLE_SEGMENTS;
    points.push({
      x: centerX + radiusMm * Math.cos(angle),
      y: onEdge ? 0 : radiusMm * Math.sin(angle),
    });
  }
  points.push({ x: dims.outerWidthMm, y: 0 });
  points.push({ x: dims.outerWidthMm, y: lengthMm });
  points.push({ x: 0, y: lengthMm });
  points.push({ x: 0, y: 0 });
  return { closed: true, points };
}

// The battlement above merges even-cell runs at v = t with the side walls;
// dedupe consecutive duplicates only (the ring is already simple).
function cleanRing(points: ReadonlyArray<Vec2>): Vec2[] {
  const out: Vec2[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last !== undefined && last.x === point.x && last.y === point.y) continue;
    out.push(point);
  }
  return out;
}
