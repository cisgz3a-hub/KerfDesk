/**
 * Physical contract tests for the V2 box joinery engine.
 * Run: npx tsx tests/box-joinery-v2.test.ts
 */
import { generateBoxFacesV2, createBoxJoineryModel, validateBoxJoineryModel } from '../src/core/box/boxGeometryV2';
import { compensatedInterval, featureKindForRole } from '../src/core/box/jointPattern';
declare const process: { exit(code?: number): never };

import type { BoxEdgeName, BoxFace, BoxPanelName, JointPattern, RenderedFeatureDebug } from '../src/core/box/joineryTypes';

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

function featureFor(face: BoxFace, edge: BoxEdgeName): RenderedFeatureDebug[] {
  return face.debugEdges?.find(e => e.edge === edge)?.features ?? [];
}

function faceByName(faces: BoxFace[], name: BoxPanelName): BoxFace {
  const face = faces.find(f => f.name === name);
  if (!face) throw new Error(`missing face ${name}`);
  return face;
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
  cornerRelief: 'micro-overcut' as const,
  openTop: false,
};

console.log('\n=== V2 box joinery physical contracts ===\n');

{
  const model = createBoxJoineryModel(params);
  const report = validateBoxJoineryModel(model);
  assert(report.ok, `joinery model validates (${report.errors.join('; ') || 'no errors'})`);
  assert(model.joints.length === 12, 'closed box has 12 explicit physical joints');
  assert(model.patterns.length === model.joints.length, 'each physical joint owns one shared JointPattern');
  assert(model.metrics.physicalTabDepth >= params.thickness + params.tabExtraDepth - 0.001, 'physical tab depth includes tab overtravel');
  assert(model.metrics.physicalSlotDepth >= params.thickness + params.slotExtraDepth - 0.001, 'physical slot depth includes slot overtravel');
  assert(model.metrics.depthOvertravel >= 0.1, 'slot is deeper than tab so parts do not bottom out');
}

{
  const openModel = createBoxJoineryModel({ ...params, openTop: true });
  const closedFaces = generateBoxFacesV2(params);
  const openFaces = generateBoxFacesV2({ ...params, openTop: true });
  assert(closedFaces.length === 6, 'closed V2 box generates 6 panels');
  assert(openFaces.length === 5, 'open-top V2 box generates 5 panels');
  assert(openModel.joints.length === 8, 'open-top box omits top-to-wall joints');
}

{
  const model = createBoxJoineryModel(params);
  for (const joint of model.joints) {
    const pattern = model.patterns.find(p => p.id === joint.id) as JointPattern | undefined;
    const primaryEdge = model.edgeSpecs.find(e => e.panel === joint.primary.panel && e.edge === joint.primary.edge);
    const secondaryEdge = model.edgeSpecs.find(e => e.panel === joint.secondary.panel && e.edge === joint.secondary.edge);
    assert(!!pattern, `${joint.id}: shared pattern exists`);
    assert(!!primaryEdge && !!secondaryEdge, `${joint.id}: both mating edge contracts exist`);
    if (!pattern || !primaryEdge || !secondaryEdge) continue;
    assert(primaryEdge.role === 'primary', `${joint.id}: primary edge role assigned`);
    assert(secondaryEdge.role === 'secondary', `${joint.id}: secondary edge role assigned`);
    assertNear(primaryEdge.length, secondaryEdge.length, 0.001, `${joint.id}: mating edges have same length`);
    assert(pattern.segmentCount % 2 === 1, `${joint.id}: odd segment count keeps matching corner phase`);

    for (const interval of pattern.intervals) {
      const primaryKind = featureKindForRole(interval, 'primary');
      const secondaryKind = featureKindForRole(interval, 'secondary');
      assert(primaryKind !== secondaryKind, `${joint.id} interval ${interval.index}: mating features are complementary`);
      const primaryComp = compensatedInterval(interval, primaryKind, pattern.length, model.metrics);
      const secondaryComp = compensatedInterval(interval, secondaryKind, pattern.length, model.metrics);
      if (interval.index > 0 && interval.index < pattern.intervals.length - 1) {
        const primaryPhysical = primaryKind === 'tab' ? primaryComp.drawnWidth - model.metrics.kerf : primaryComp.drawnWidth + model.metrics.kerf;
        const secondaryPhysical = secondaryKind === 'tab' ? secondaryComp.drawnWidth - model.metrics.kerf : secondaryComp.drawnWidth + model.metrics.kerf;
        const tabWidth = primaryKind === 'tab' ? primaryPhysical : secondaryPhysical;
        const socketWidth = primaryKind === 'socket' ? primaryPhysical : secondaryPhysical;
        assertNear(socketWidth - tabWidth, model.metrics.expectedWidthClearance, 0.005, `${joint.id} interval ${interval.index}: socket minus tab equals clearance`);
      }
    }
  }
}

{
  const faces = generateBoxFacesV2(params);
  const bottom = faceByName(faces, 'Bottom');
  const front = faceByName(faces, 'Front');
  const bottomFront = featureFor(bottom, 'top');
  const frontBottom = featureFor(front, 'bottom');
  assert(bottomFront.length === frontBottom.length, 'Bottom.front and Front.bottom expose same feature count');
  for (let i = 0; i < bottomFront.length; i++) {
    assert(bottomFront[i]!.kind !== frontBottom[i]!.kind, `Bottom.front and Front.bottom feature ${i} are complementary`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
