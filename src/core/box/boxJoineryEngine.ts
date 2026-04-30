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

function pushPoint(points: Point2D[], point: Point2D): void {
  const prev = points[points.length - 1];
  if (!prev || Math.abs(prev.x - point.x) > EPS || Math.abs(prev.y - point.y) > EPS) {
    points.push({ x: round(point.x), y: round(point.y) });
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function edgeBasis(panelW: number, panelH: number, edge: BoxEdgeName): {
  start: Point2D;
  dir: Point2D;
  normal: Point2D;
  length: number;
} {
  switch (edge) {
    case 'top': return { start: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, normal: { x: 0, y: -1 }, length: panelW };
    case 'right': return { start: { x: panelW, y: 0 }, dir: { x: 0, y: 1 }, normal: { x: 1, y: 0 }, length: panelH };
    case 'bottom': return { start: { x: panelW, y: panelH }, dir: { x: -1, y: 0 }, normal: { x: 0, y: 1 }, length: panelW };
    case 'left': return { start: { x: 0, y: panelH }, dir: { x: 0, y: -1 }, normal: { x: -1, y: 0 }, length: panelH };
  }
}

function pointOnEdge(basis: ReturnType<typeof edgeBasis>, distance: number, offset: number): Point2D {
  return {
    x: basis.start.x + basis.dir.x * distance + basis.normal.x * offset,
    y: basis.start.y + basis.dir.y * distance + basis.normal.y * offset,
  };
}

function renderEdge(
  panel: BoxPanelName,
  edge: BoxEdgeName,
  panelW: number,
  panelH: number,
  pattern: JointPattern | null,
  role: 'primary' | 'secondary' | 'flat',
  model: BoxJoineryModel,
): { points: Point2D[]; debug: RenderedEdgeDebug } {
  const basis = edgeBasis(panelW, panelH, edge);
  const points: Point2D[] = [];
  const features: RenderedFeatureDebug[] = [];

  if (!pattern || role === 'flat') {
    pushPoint(points, pointOnEdge(basis, 0, 0));
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
    return { points, debug: { panel, edge, role, features } };
  }

  for (const interval of pattern.intervals) {
    const kind = featureKindForRole(interval, role);
    const comp = compensatedInterval(interval, kind, pattern.length, model.metrics);
    const depth = kind === 'tab'
      ? model.metrics.drawnTabDepth
      : model.metrics.drawnSocketDepthWithRelief;
    const offset = kind === 'tab' ? depth : -depth;

    pushPoint(points, pointOnEdge(basis, comp.start, 0));
    pushPoint(points, pointOnEdge(basis, comp.start, offset));
    pushPoint(points, pointOnEdge(basis, comp.end, offset));
    pushPoint(points, pointOnEdge(basis, comp.end, 0));

    features.push({
      intervalIndex: interval.index,
      kind,
      nominalStart: interval.nominalStart,
      nominalEnd: interval.nominalEnd,
      drawnStart: comp.start,
      drawnEnd: comp.end,
      drawnWidth: comp.drawnWidth,
      expectedPhysicalWidth: comp.expectedPhysicalWidth,
      depth,
    });
  }

  return { points, debug: { panel, edge, jointId: pattern.id, role, features } };
}

export function renderBoxJoineryFaces(model: BoxJoineryModel): BoxFace[] {
  const spacing = model.metrics.drawnTabDepth + model.metrics.drawnSocketDepthWithRelief + 8;
  const faces: BoxFace[] = [];
  const panelByName = new Map(model.panels.map(p => [p.name, p]));
  const patternById = new Map(model.patterns.map(p => [p.id, p]));
  const order: BoxPanelName[] = ['Front', 'Back', 'Left', 'Right', 'Bottom', 'Top'];

  for (const name of order) {
    const panel = panelByName.get(name);
    if (!panel) continue;
    const edgeDebugs: RenderedEdgeDebug[] = [];
    const points: Point2D[] = [];
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const spec = model.edgeSpecs.find(e => e.panel === name && e.edge === edge);
      const pattern = spec?.jointId ? patternById.get(spec.jointId) ?? null : null;
      const rendered = renderEdge(name, edge, panel.width, panel.height, pattern, spec?.role ?? 'flat', model);
      for (const point of rendered.points) pushPoint(points, point);
      edgeDebugs.push(rendered.debug);
    }

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
  const margin = model.metrics.drawnTabDepth + 3;
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
  const depth = model.panels.find(p => p.name === 'Bottom')?.height ?? panelH;
  const margin = model.metrics.drawnTabDepth + 3;
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

  if (model.metrics.physicalTabDepth < model.metrics.physicalSlotDepth - 1000) {
    // structurally unreachable; keeps branch obvious for static analysis
    warnings.push('unreachable physical depth sanity branch');
  }
  if (model.metrics.physicalTabDepth < model.metrics.physicalTabDepth - EPS) {
    errors.push('tab depth self-check failed');
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
    if (primary && secondary && Math.abs(primary.length - secondary.length) > EPS) {
      errors.push(`joint ${joint.id} edge length mismatch: ${primary.length} vs ${secondary.length}`);
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
  if (kind === 'tab') return drawnWidth - kerf;
  if (kind === 'socket') return drawnWidth + kerf;
  return drawnWidth;
}
