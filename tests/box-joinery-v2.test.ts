/**
 * Physical contract tests for the V5 verified-topology box joinery engine.
 * Run: npx tsx tests/box-joinery-v2.test.ts
 */
import { generateBoxFacesV2, createBoxJoineryModel, validateBoxJoineryModel } from '../src/core/box/boxGeometryV2';
import { featureKindForRole } from '../src/core/box/jointPattern';
declare const process: { exit(code?: number): never };

import type { BoxEdgeName, BoxFace, BoxPanelName, RenderedFeatureDebug } from '../src/core/box/joineryTypes';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function assertNear(actual: number, expected: number, tol: number, msg: string): void {
  assert(Math.abs(actual - expected) <= tol, `${msg} (expected ${expected}, got ${actual})`);
}

function featuresFor(face: BoxFace, edge: BoxEdgeName): RenderedFeatureDebug[] {
  return face.debugEdges?.find(e => e.edge === edge)?.features ?? [];
}

function socketsFor(face: BoxFace, edge: BoxEdgeName): RenderedFeatureDebug[] {
  return featuresFor(face, edge).filter(f => f.kind === 'socket');
}

function faceByName(faces: BoxFace[], name: BoxPanelName): BoxFace {
  const face = faces.find(f => f.name === name);
  if (!face) throw new Error(`missing face ${name}`);
  return face;
}

function minSegmentLength(face: BoxFace): number {
  let min = Infinity;
  for (let i = 0; i < face.points.length; i++) {
    const a = face.points[i]!;
    const b = face.points[(i + 1) % face.points.length]!;
    const len = Math.hypot(a.x - b.x, a.y - b.y);
    if (len > 0.001) min = Math.min(min, len);
  }
  return min;
}

const params = {
  width: 80,
  height: 50,
  depth: 40,
  thickness: 3,
  fingerWidth: 10,
  kerf: 0.1,
  fitAllowance: 0.05,
  tabExtraDepth: 0.2,
  slotExtraDepth: 0.35,
  cornerRelief: 'none' as const,
  openTop: false,
};

console.log('\n=== V5 verified-topology box joinery contracts ===\n');

{
  const model = createBoxJoineryModel(params);
  const report = validateBoxJoineryModel(model);
  assert(report.ok, `joinery model validates (${report.errors.join('; ') || 'no errors'})`);
  assert(model.joints.length === 12, 'closed box has 12 explicit physical joints');
  assert(model.patterns.length === model.joints.length, 'each physical joint owns one shared pattern');
  assert(model.metrics.physicalTabDepth >= params.thickness + params.tabExtraDepth - 0.001, 'physical tab depth includes tab overtravel');
  assert(model.metrics.physicalSlotDepth >= params.thickness + params.slotExtraDepth - 0.001, 'physical slot depth includes slot overtravel');
  assert(model.metrics.depthOvertravel >= 0.1, 'slot is deeper than tab so parts do not bottom out');
}

{
  const openModel = createBoxJoineryModel({ ...params, openTop: true });
  const closedFaces = generateBoxFacesV2(params);
  const openFaces = generateBoxFacesV2({ ...params, openTop: true });
  assert(closedFaces.length === 6, 'closed V5 box generates 6 panels');
  assert(openFaces.length === 5, 'open-top V5 box generates 5 panels');
  assert(openModel.joints.length === 8, 'open-top box omits top-to-wall joints');
}

{
  const model = createBoxJoineryModel(params);
  for (const joint of model.joints) {
    const pattern = model.patterns.find(p => p.id === joint.id);
    const primaryEdge = model.edgeSpecs.find(e => e.panel === joint.primary.panel && e.edge === joint.primary.edge);
    const secondaryEdge = model.edgeSpecs.find(e => e.panel === joint.secondary.panel && e.edge === joint.secondary.edge);
    assert(!!pattern, `${joint.id}: shared pattern exists`);
    assert(!!primaryEdge && !!secondaryEdge, `${joint.id}: both mating edge contracts exist`);
    if (!pattern || !primaryEdge || !secondaryEdge) continue;

    assert(primaryEdge.role === 'primary', `${joint.id}: primary/direct-cut edge role assigned`);
    assert(secondaryEdge.role === 'secondary', `${joint.id}: secondary/inverse-cut edge role assigned`);
    assertNear(primaryEdge.jointLength, secondaryEdge.jointLength, 0.001, `${joint.id}: active spans have same length`);
    assertNear(pattern.length, joint.length, 0.001, `${joint.id}: pattern length equals joint span`);

    let directSockets = 0;
    let inverseSockets = 0;
    for (const interval of pattern.intervals) {
      const primaryKind = featureKindForRole(interval, 'primary');
      const secondaryKind = featureKindForRole(interval, 'secondary');
      assert(primaryKind !== secondaryKind, `${joint.id} interval ${interval.index}: direct/inverse phases are complementary`);
      if (primaryKind === 'socket') directSockets++;
      if (secondaryKind === 'socket') inverseSockets++;
    }
    assert(directSockets > 0, `${joint.id}: direct side has socket cuts`);
    assert(inverseSockets > 0, `${joint.id}: inverse side has socket cuts`);
  }
}

{
  const model = createBoxJoineryModel(params);
  for (const id of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) {
    const joint = model.joints.find(j => j.id === id);
    assert(!!joint, `${id}: depth-running joint exists`);
    if (!joint) continue;
    assertNear(joint.length, params.depth - 2 * params.thickness, 0.001, `${id}: uses depth - 2*thickness`);
    assertNear(joint.primary.start ?? 0, params.thickness, 0.001, `${id}: primary starts after one material thickness`);
    assertNear(joint.secondary.start ?? 0, params.thickness, 0.001, `${id}: secondary starts after one material thickness`);
  }
}

{
  const faces = generateBoxFacesV2(params);
  const sizes: Record<BoxPanelName, { width: number; height: number }> = {
    Front: { width: params.width, height: params.height },
    Back: { width: params.width, height: params.height },
    Left: { width: params.depth, height: params.height },
    Right: { width: params.depth, height: params.height },
    Bottom: { width: params.width, height: params.depth },
    Top: { width: params.width, height: params.depth },
  };

  for (const face of faces) {
    const size = sizes[face.name];
    const outside = face.points.filter(p =>
      p.x < -0.001 || p.y < -0.001 || p.x > size.width + 0.001 || p.y > size.height + 0.001,
    );
    assert(outside.length === 0, `${face.name}: V5 emits clean final contour inside the panel rectangle`);
    assert(minSegmentLength(face) > 0.2, `${face.name}: no tiny visible tick/stub segments`);
  }
}

{
  const faces = generateBoxFacesV2(params);
  const front = faceByName(faces, 'Front');
  const bottom = faceByName(faces, 'Bottom');
  const left = faceByName(faces, 'Left');

  assert(socketsFor(front, 'bottom').length > 0, 'Front.bottom has direct socket cuts');
  assert(socketsFor(bottom, 'top').length > 0, 'Bottom.top has inverse socket cuts');
  assert(socketsFor(front, 'bottom').length !== socketsFor(bottom, 'top').length, 'direct cuts and inverse cuts are complementary, not duplicate tooth copies');

  const leftBottom = left.debugEdges?.find(e => e.edge === 'bottom');
  const bottomLeft = bottom.debugEdges?.find(e => e.edge === 'left');
  assertNear(leftBottom?.jointStart ?? -1, params.thickness, 0.001, 'Left.bottom starts after corner thickness');
  assertNear(bottomLeft?.jointStart ?? -1, params.thickness, 0.001, 'Bottom.left starts after corner thickness');
}


{
  const faces = generateBoxFacesV2(params);
  for (const face of faces) {
    const first = face.points[0]!;
    const last = face.points[face.points.length - 1]!;
    const closeDx = Math.abs(first.x - last.x);
    const closeDy = Math.abs(first.y - last.y);
    assert(closeDx < 0.001 || closeDy < 0.001, `${face.name}: polygon auto-close is axis-aligned, not diagonal`);

    for (let i = 1; i < face.points.length; i++) {
      const prev = face.points[i - 1]!;
      const curr = face.points[i]!;
      const dx = Math.abs(curr.x - prev.x);
      const dy = Math.abs(curr.y - prev.y);
      assert(dx < 0.001 || dy < 0.001, `${face.name}: segment ${i} is axis-aligned`);
    }
  }
}


console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
