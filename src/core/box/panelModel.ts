import type { BoxJoineryModel, BoxJoineryParams, BoxPanelName, EdgeSpec, JointSpec, PanelSpec } from './joineryTypes';
import { computeBoxJointMetricsV2, createJointPattern } from './jointPattern';

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function edgeLengthForPanelEdge(panels: PanelSpec[], panel: BoxPanelName, edge: 'top' | 'right' | 'bottom' | 'left'): number {
  const spec = panels.find(p => p.name === panel);
  if (!spec) return 0;
  return edge === 'top' || edge === 'bottom' ? spec.width : spec.height;
}

function roleForEdge(joint: JointSpec, panel: BoxPanelName, edge: 'top' | 'right' | 'bottom' | 'left'): 'primary' | 'secondary' | null {
  if (joint.primary.panel === panel && joint.primary.edge === edge) return 'primary';
  if (joint.secondary.panel === panel && joint.secondary.edge === edge) return 'secondary';
  return null;
}

export function createBoxJoineryModel(params: BoxJoineryParams): BoxJoineryModel {
  const width = finitePositive(params.width, 80);
  const height = finitePositive(params.height, 50);
  const depth = finitePositive(params.depth, 40);
  const thickness = finitePositive(params.thickness, 3);
  const fingerWidth = finitePositive(params.fingerWidth, 10);
  const metrics = computeBoxJointMetricsV2(
    thickness,
    params.kerf,
    params.fitAllowance,
    params.tabExtraDepth,
    params.slotExtraDepth,
    params.cornerRelief,
  );

  const panels: PanelSpec[] = [
    { name: 'Front', width, height },
    { name: 'Back', width, height },
    { name: 'Left', width: depth, height },
    { name: 'Right', width: depth, height },
    { name: 'Bottom', width, height: depth },
  ];
  if (!params.openTop) panels.push({ name: 'Top', width, height: depth });

  const joints: JointSpec[] = [
    // Bottom-to-wall joints.
    { id: 'bottom-front', length: width, primary: { panel: 'Bottom', edge: 'top' }, secondary: { panel: 'Front', edge: 'bottom' } },
    { id: 'bottom-back', length: width, primary: { panel: 'Bottom', edge: 'bottom' }, secondary: { panel: 'Back', edge: 'bottom' } },
    { id: 'bottom-left', length: depth, primary: { panel: 'Bottom', edge: 'left' }, secondary: { panel: 'Left', edge: 'bottom' } },
    { id: 'bottom-right', length: depth, primary: { panel: 'Bottom', edge: 'right' }, secondary: { panel: 'Right', edge: 'bottom' } },
    // Wall-to-wall vertical corners.
    { id: 'front-left', length: height, primary: { panel: 'Front', edge: 'left' }, secondary: { panel: 'Left', edge: 'right' } },
    { id: 'front-right', length: height, primary: { panel: 'Front', edge: 'right' }, secondary: { panel: 'Right', edge: 'left' } },
    { id: 'back-left', length: height, primary: { panel: 'Back', edge: 'left' }, secondary: { panel: 'Left', edge: 'left' } },
    { id: 'back-right', length: height, primary: { panel: 'Back', edge: 'right' }, secondary: { panel: 'Right', edge: 'right' } },
  ];

  if (!params.openTop) {
    joints.push(
      { id: 'top-front', length: width, primary: { panel: 'Top', edge: 'top' }, secondary: { panel: 'Front', edge: 'top' } },
      { id: 'top-back', length: width, primary: { panel: 'Top', edge: 'bottom' }, secondary: { panel: 'Back', edge: 'top' } },
      { id: 'top-left', length: depth, primary: { panel: 'Top', edge: 'left' }, secondary: { panel: 'Left', edge: 'top' } },
      { id: 'top-right', length: depth, primary: { panel: 'Top', edge: 'right' }, secondary: { panel: 'Right', edge: 'top' } },
    );
  }

  const patterns = joints.map((joint, index) => createJointPattern(joint.id, joint.length, fingerWidth, index % 2 === 0 ? 0 : 1));
  const edgeSpecs: EdgeSpec[] = [];
  for (const panel of panels) {
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const joint = joints.find(j => roleForEdge(j, panel.name, edge));
      const role = joint ? roleForEdge(joint, panel.name, edge)! : 'flat';
      edgeSpecs.push({
        panel: panel.name,
        edge,
        jointId: joint?.id,
        role,
        length: edgeLengthForPanelEdge(panels, panel.name, edge),
      });
    }
  }

  return { panels, joints, patterns, edgeSpecs, metrics };
}
