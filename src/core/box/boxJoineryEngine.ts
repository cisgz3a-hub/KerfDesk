import type {
  BoxEdgeName,
  BoxFace,
  BoxJoineryModel,
  BoxPanelName,
  JointContractReport,
  JointFeatureKind,
  JointPattern,
  Point2D,
  RenderedEdgeDebug,
  RenderedFeatureDebug,
} from './joineryTypes';
import { compensatedInterval, featureKindForRole } from './jointPattern';

const EPS = 0.001;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pushPoint(points: Point2D[], point: Point2D): void {
  const rounded = { x: round(point.x), y: round(point.y) };
  const prev = points[points.length - 1];
  if (!prev || Math.abs(prev.x - rounded.x) > EPS || Math.abs(prev.y - rounded.y) > EPS) {
    points.push(rounded);
  }
}


function closeContourAxisAligned(points: Point2D[]): void {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return;

  const dx = Math.abs(first.x - last.x);
  const dy = Math.abs(first.y - last.y);

  if (dx > EPS && dy > EPS) {
    // The rendered edge traversal can begin/end at the first active socket
    // when both adjacent corner intervals are solid material. A closed polygon
    // would otherwise auto-close with a diagonal chord. Route that closure
    // through the missing rectangle corner instead.
    pushPoint(points, { x: last.x, y: first.y });
  }
}

function edgeBasis(panelW: number, panelH: number, edge: BoxEdgeName): {
  start: Point2D;
  dir: Point2D;
  outward: Point2D;
  length: number;
} {
  switch (edge) {
    case 'top':
      return { start: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, outward: { x: 0, y: -1 }, length: panelW };
    case 'right':
      return { start: { x: panelW, y: 0 }, dir: { x: 0, y: 1 }, outward: { x: 1, y: 0 }, length: panelH };
    case 'bottom':
      return { start: { x: panelW, y: panelH }, dir: { x: -1, y: 0 }, outward: { x: 0, y: 1 }, length: panelW };
    case 'left':
      return { start: { x: 0, y: panelH }, dir: { x: 0, y: -1 }, outward: { x: -1, y: 0 }, length: panelH };
  }
}

function pointOnEdge(
  basis: ReturnType<typeof edgeBasis>,
  distance: number,
  inwardOffset: number,
): Point2D {
  return {
    x: basis.start.x + basis.dir.x * distance - basis.outward.x * inwardOffset,
    y: basis.start.y + basis.dir.y * distance - basis.outward.y * inwardOffset,
  };
}

/**
 * Render a single panel edge as a clean closed-contour segment.
 *
 * V5 emits only socket notches. Tab intervals remain flat boundary material.
 * This creates one final outline path per panel and avoids the stray tick/stub
 * geometry produced by the earlier subtractive-fragment renderer.
 */
function mergeSocketCuts(cuts: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = cuts
    .filter(cut => cut.end - cut.start > EPS)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const cut of sorted) {
    const last = merged[merged.length - 1];
    if (!last || cut.start > last.end + EPS) {
      merged.push({ start: cut.start, end: cut.end });
    } else {
      last.end = Math.max(last.end, cut.end);
    }
  }
  return merged;
}

function renderEdge(
  panel: BoxPanelName,
  edge: BoxEdgeName,
  panelW: number,
  panelH: number,
  pattern: JointPattern | null,
  role: 'primary' | 'secondary' | 'flat',
  jointStart: number,
  jointLength: number,
  model: BoxJoineryModel,
): { points: Point2D[]; debug: RenderedEdgeDebug } {
  const basis = edgeBasis(panelW, panelH, edge);
  const points: Point2D[] = [];
  const features: RenderedFeatureDebug[] = [];

  pushPoint(points, pointOnEdge(basis, 0, 0));

  if (!pattern || role === 'flat') {
    pushPoint(points, pointOnEdge(basis, basis.length, 0));
    features.push({
      intervalIndex: -1,
      kind: 'flat',
      nominalStart: 0,
      nominalEnd: basis.length,
      drawnStart: 0,
      drawnEnd: basis.length,
      drawnWidth: basis.length,
      expectedPhysicalWidth: basis.length,
      depth: 0,
    });
    return { points, debug: { panel, edge, role, jointStart: 0, jointLength: basis.length, features } };
  }

  const activeStart = Math.max(0, Math.min(jointStart, basis.length));
  const activeLength = Math.max(0, Math.min(jointLength, basis.length - activeStart));
  const activeEnd = activeStart + activeLength;
  const depth = model.metrics.drawnSocketDepthWithRelief;

  const socketCuts: Array<{ start: number; end: number }> = [];

  for (const interval of pattern.intervals) {
    const kind = featureKindForRole(interval, role);
    const nominalStart = activeStart + interval.nominalStart;
    const nominalEnd = activeStart + interval.nominalEnd;

    if (kind !== 'socket') {
      features.push({
        intervalIndex: interval.index,
        kind,
        nominalStart,
        nominalEnd,
        drawnStart: nominalStart,
        drawnEnd: nominalEnd,
        drawnWidth: nominalEnd - nominalStart,
        expectedPhysicalWidth: nominalEnd - nominalStart,
        depth: 0,
      });
      continue;
    }

    const comp = compensatedInterval(interval, kind, pattern.length, model.metrics);
    const drawnStart = Math.max(activeStart, Math.min(activeEnd, activeStart + comp.start));
    const drawnEnd = Math.max(activeStart, Math.min(activeEnd, activeStart + comp.end));

    features.push({
      intervalIndex: interval.index,
      kind,
      nominalStart,
      nominalEnd,
      drawnStart,
      drawnEnd,
      drawnWidth: Math.max(0, drawnEnd - drawnStart),
      expectedPhysicalWidth: comp.expectedPhysicalWidth,
      depth,
    });

    socketCuts.push({ start: drawnStart, end: drawnEnd });
  }

  // Draw only the union of socket intervals. This is the important V5.1 fix:
  // kerf/clearance can expand socket intervals slightly beyond nominal bounds.
  // Drawing each original interval independently caused 0.02–0.05mm backtracking
  // segments that appeared as ugly ticks/stubs on the canvas. Merging first
  // produces one clean, monotonic, closed panel contour.
  let cursor = 0;
  for (const cut of mergeSocketCuts(socketCuts)) {
    const cutStart = Math.max(cursor, cut.start);
    const cutEnd = Math.max(cutStart, cut.end);
    if (cutStart - cursor > EPS) {
      pushPoint(points, pointOnEdge(basis, cutStart, 0));
    }
    pushPoint(points, pointOnEdge(basis, cutStart, depth));
    pushPoint(points, pointOnEdge(basis, cutEnd, depth));
    pushPoint(points, pointOnEdge(basis, cutEnd, 0));
    cursor = cutEnd;
  }

  pushPoint(points, pointOnEdge(basis, basis.length, 0));

  return { points, debug: { panel, edge, jointId: pattern.id, role, jointStart: activeStart, jointLength: activeLength, features } };
}

export function renderBoxJoineryFaces(model: BoxJoineryModel): BoxFace[] {
  const spacing = model.metrics.drawnSocketDepthWithRelief + 8;
  const faces: BoxFace[] = [];
  const panelByName = new Map(model.panels.map(p => [p.name, p]));
  const patternById = new Map(model.patterns.map(p => [p.id, p]));
  const order: BoxPanelName[] = ['Front', 'Back', 'Left', 'Right', 'Bottom', 'Top'];

  for (const name of order) {
    const panel = panelByName.get(name);
    if (!panel) continue;

    const points: Point2D[] = [];
    const edgeDebugs: RenderedEdgeDebug[] = [];

    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const spec = model.edgeSpecs.find(e => e.panel === name && e.edge === edge);
      const pattern = spec?.jointId ? patternById.get(spec.jointId) ?? null : null;
      const rendered = renderEdge(
        name,
        edge,
        panel.width,
        panel.height,
        pattern,
        spec?.role ?? 'flat',
        spec?.jointStart ?? 0,
        spec?.jointLength ?? (edge === 'top' || edge === 'bottom' ? panel.width : panel.height),
        model,
      );
      for (const point of rendered.points) pushPoint(points, point);
      edgeDebugs.push(rendered.debug);
    }

    closeContourAxisAligned(points);

    faces.push({
      name,
      points,
      offsetX: layoutOffsetX(name, panel.width, spacing, model),
      offsetY: layoutOffsetY(name, panel.height, spacing, model),
      debugEdges: edgeDebugs,
    });
  }

  return faces;
}

function layoutOffsetX(name: BoxPanelName, panelW: number, spacing: number, model: BoxJoineryModel): number {
  const width = model.panels.find(p => p.name === 'Front')?.width ?? panelW;
  const depth = model.panels.find(p => p.name === 'Left')?.width ?? panelW;
  const margin = model.metrics.drawnSocketDepthWithRelief + 3;
  switch (name) {
    case 'Front': return margin;
    case 'Back': return margin + width + spacing;
    case 'Left': return margin;
    case 'Right': return margin + depth + spacing;
    case 'Bottom': return margin;
    case 'Top': return margin + width + spacing;
  }
}

function layoutOffsetY(name: BoxPanelName, panelH: number, spacing: number, model: BoxJoineryModel): number {
  const height = model.panels.find(p => p.name === 'Front')?.height ?? panelH;
  const margin = model.metrics.drawnSocketDepthWithRelief + 3;
  switch (name) {
    case 'Front':
    case 'Back': return margin;
    case 'Left':
    case 'Right': return margin + height + spacing;
    case 'Bottom':
    case 'Top': return margin + height + spacing + height + spacing;
  }
}

export function validateBoxJoineryModel(model: BoxJoineryModel): JointContractReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const edgeByKey = new Map(model.edgeSpecs.map(edge => [`${edge.panel}.${edge.edge}`, edge]));
  const patternById = new Map(model.patterns.map(pattern => [pattern.id, pattern]));

  if (model.metrics.physicalSlotDepth < model.metrics.physicalTabDepth - EPS) {
    errors.push('slot depth must be at least tab depth');
  }
  if (model.metrics.depthOvertravel < 0.1 - EPS) {
    warnings.push(`slot overtravel is ${model.metrics.depthOvertravel.toFixed(3)}mm; 0.10mm+ is recommended so tabs do not bottom out`);
  }

  for (const joint of model.joints) {
    const primary = edgeByKey.get(`${joint.primary.panel}.${joint.primary.edge}`);
    const secondary = edgeByKey.get(`${joint.secondary.panel}.${joint.secondary.edge}`);
    const pattern = patternById.get(joint.id);

    if (!primary || !secondary) errors.push(`joint ${joint.id} is missing a rendered edge contract`);
    if (!pattern) errors.push(`joint ${joint.id} is missing its shared pattern`);

    if (primary && secondary && Math.abs(primary.jointLength - secondary.jointLength) > EPS) {
      errors.push(`joint ${joint.id} active span mismatch: ${primary.jointLength} vs ${secondary.jointLength}`);
    }
    if (primary && primary.jointStart + primary.jointLength > primary.length + EPS) {
      errors.push(`joint ${joint.id} primary active span exceeds panel edge`);
    }
    if (secondary && secondary.jointStart + secondary.jointLength > secondary.length + EPS) {
      errors.push(`joint ${joint.id} secondary active span exceeds panel edge`);
    }
    if (pattern && Math.abs(pattern.length - joint.length) > EPS) {
      errors.push(`joint ${joint.id} pattern length mismatch: ${pattern.length} vs ${joint.length}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function getJointDebugFeatures(face: BoxFace, edge: BoxEdgeName): RenderedFeatureDebug[] {
  return face.debugEdges?.find(e => e.edge === edge)?.features ?? [];
}

export function physicalWidthForKind(kind: JointFeatureKind, drawnWidth: number, kerf: number): number {
  if (kind === 'socket') return drawnWidth + kerf;
  return drawnWidth;
}
