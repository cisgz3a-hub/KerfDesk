import type { BoxJoineryModel, BoxJoineryParams, BoxPanelName, EdgeSpec, JointEndpoint, JointSpec, PanelSpec } from './joineryTypes';
import { computeBoxJointMetricsV2, createJointPattern } from './jointPattern';

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function edgeLengthForPanelEdge(panels: PanelSpec[], panel: BoxPanelName, edge: 'top' | 'right' | 'bottom' | 'left'): number {
  const spec = panels.find(p => p.name === panel);
  if (!spec) return 0;
  return edge === 'top' || edge === 'bottom' ? spec.width : spec.height;
}

function endpointForEdge(
  joint: JointSpec,
  panel: BoxPanelName,
  edge: 'top' | 'right' | 'bottom' | 'left',
): { role: 'primary' | 'secondary'; endpoint: JointEndpoint } | null {
  if (joint.primary.panel === panel && joint.primary.edge === edge) return { role: 'primary', endpoint: joint.primary };
  if (joint.secondary.panel === panel && joint.secondary.edge === edge) return { role: 'secondary', endpoint: joint.secondary };
  return null;
}

export function createBoxJoineryModel(params: BoxJoineryParams): BoxJoineryModel {
  const width = finitePositive(params.width, 80);
  const height = finitePositive(params.height, 50);
  const depth = finitePositive(params.depth, 40);
  const thickness = finitePositive(params.thickness, 3);
  const fingerWidth = finitePositive(params.fingerWidth, Math.max(thickness * 2, 6));
  const metrics = computeBoxJointMetricsV2(
    thickness,
    params.kerf,
    params.fitAllowance,
    params.tabExtraDepth,
    params.slotExtraDepth,
    params.cornerRelief ?? 'none',
  );

  const panels: PanelSpec[] = [
    { name: 'Front', width, height },
    { name: 'Back', width, height },
    { name: 'Left', width: depth, height },
    { name: 'Right', width: depth, height },
    { name: 'Bottom', width, height: depth },
  ];
  if (!params.openTop) panels.push({ name: 'Top', width, height: depth });

  // Verified OpenSCAD topology: depth-running floor/lid joints are not full
  // depth. They start after one material thickness and span depth - 2*t so the
  // side/bottom/top joints do not collide with front/back vertical corner joints.
  const depthJointLength = Math.max(thickness, depth - 2 * thickness);
  const depthJointStart = depthJointLength < depth ? thickness : 0;

  // Primary = direct cuts. Secondary = inverse cuts.
  // This reproduces the proven cuts()/invcuts() relationship without copying code.
  const joints: JointSpec[] = [
    // Bottom-to-wall joints.
    { id: 'bottom-front', length: width, primary: { panel: 'Front', edge: 'bottom' }, secondary: { panel: 'Bottom', edge: 'top' } },
    { id: 'bottom-back', length: width, primary: { panel: 'Back', edge: 'bottom' }, secondary: { panel: 'Bottom', edge: 'bottom' } },
    { id: 'bottom-left', length: depthJointLength, primary: { panel: 'Left', edge: 'bottom', start: depthJointStart }, secondary: { panel: 'Bottom', edge: 'left', start: depthJointStart } },
    { id: 'bottom-right', length: depthJointLength, primary: { panel: 'Right', edge: 'bottom', start: depthJointStart }, secondary: { panel: 'Bottom', edge: 'right', start: depthJointStart } },

    // Wall-to-wall vertical corners.
    { id: 'front-left', length: height, primary: { panel: 'Front', edge: 'left' }, secondary: { panel: 'Left', edge: 'right' } },
    { id: 'front-right', length: height, primary: { panel: 'Front', edge: 'right' }, secondary: { panel: 'Right', edge: 'left' } },
    { id: 'back-left', length: height, primary: { panel: 'Back', edge: 'left' }, secondary: { panel: 'Left', edge: 'left' } },
    { id: 'back-right', length: height, primary: { panel: 'Back', edge: 'right' }, secondary: { panel: 'Right', edge: 'right' } },
  ];

  if (!params.openTop) {
    joints.push(
      { id: 'top-front', length: width, primary: { panel: 'Front', edge: 'top' }, secondary: { panel: 'Top', edge: 'top' } },
      { id: 'top-back', length: width, primary: { panel: 'Back', edge: 'top' }, secondary: { panel: 'Top', edge: 'bottom' } },
      { id: 'top-left', length: depthJointLength, primary: { panel: 'Left', edge: 'top', start: depthJointStart }, secondary: { panel: 'Top', edge: 'left', start: depthJointStart } },
      { id: 'top-right', length: depthJointLength, primary: { panel: 'Right', edge: 'top', start: depthJointStart }, secondary: { panel: 'Top', edge: 'right', start: depthJointStart } },
    );
  }

  const patterns = joints.map(joint => createJointPattern(joint.id, joint.length, fingerWidth, thickness, 0));
  const edgeSpecs: EdgeSpec[] = [];

  for (const panel of panels) {
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const match = joints
        .map(joint => ({ joint, endpoint: endpointForEdge(joint, panel.name, edge) }))
        .find(entry => entry.endpoint);
      const length = edgeLengthForPanelEdge(panels, panel.name, edge);

      edgeSpecs.push({
        panel: panel.name,
        edge,
        jointId: match?.joint.id,
        role: match?.endpoint?.role ?? 'flat',
        length,
        jointStart: match?.endpoint?.endpoint.start ?? 0,
        jointLength: match?.joint.length ?? length,
      });
    }
  }

  return { panels, joints, patterns, edgeSpecs, metrics };
}
