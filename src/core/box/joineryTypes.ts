/**
 * Clean-room V2 laser box joinery model.
 *
 * This file intentionally contains LaserForge-native types only. The design is
 * based on common laser-cut joinery principles: model real panel-to-panel
 * joints, separate kerf from intentional clearance, and render both mating
 * edges from one shared pattern.
 */

export interface Point2D {
  x: number;
  y: number;
}

export type BoxPanelName = 'Front' | 'Back' | 'Left' | 'Right' | 'Bottom' | 'Top';
export type BoxEdgeName = 'top' | 'right' | 'bottom' | 'left';
export type JointEdgeRole = 'primary' | 'secondary' | 'flat';
export type JointFeatureKind = 'tab' | 'socket' | 'flat';
export type CornerReliefMode = 'none' | 'micro-overcut';
export type BoxJoineryEngine = 'legacy' | 'v2';

export interface BoxFace {
  name: BoxPanelName;
  points: Point2D[];
  offsetX: number;
  offsetY: number;
  debugEdges?: RenderedEdgeDebug[];
}

export interface BoxJoineryParams {
  width: number;
  height: number;
  depth: number;
  thickness: number;
  fingerWidth: number;
  openTop: boolean;
  kerf?: number;
  fitAllowance?: number;
  tabExtraDepth?: number;
  slotExtraDepth?: number;
  cornerRelief?: CornerReliefMode;
  engine?: BoxJoineryEngine;
}

export interface BoxJointMetricsV2 {
  kerf: number;
  burnRadius: number;
  fitAllowance: number;
  tabExtraDepth: number;
  slotExtraDepth: number;
  physicalTabDepth: number;
  physicalSlotDepth: number;
  drawnTabDepth: number;
  drawnSlotDepth: number;
  drawnSocketDepthWithRelief: number;
  widthCompensation: number;
  expectedWidthClearance: number;
  depthOvertravel: number;
}

export interface JointInterval {
  index: number;
  nominalStart: number;
  nominalEnd: number;
  primaryKind: Exclude<JointFeatureKind, 'flat'>;
}

export interface JointPattern {
  id: string;
  length: number;
  nominalSegmentWidth: number;
  segmentCount: number;
  parity: 0 | 1;
  intervals: JointInterval[];
}

export interface PanelSpec {
  name: BoxPanelName;
  width: number;
  height: number;
}

export interface EdgeSpec {
  panel: BoxPanelName;
  edge: BoxEdgeName;
  jointId?: string;
  role: JointEdgeRole;
  length: number;
}

export interface JointSpec {
  id: string;
  length: number;
  primary: { panel: BoxPanelName; edge: BoxEdgeName };
  secondary: { panel: BoxPanelName; edge: BoxEdgeName };
}

export interface BoxJoineryModel {
  panels: PanelSpec[];
  joints: JointSpec[];
  patterns: JointPattern[];
  edgeSpecs: EdgeSpec[];
  metrics: BoxJointMetricsV2;
}

export interface RenderedEdgeDebug {
  panel: BoxPanelName;
  edge: BoxEdgeName;
  jointId?: string;
  role: JointEdgeRole;
  features: RenderedFeatureDebug[];
}

export interface RenderedFeatureDebug {
  intervalIndex: number;
  kind: JointFeatureKind;
  nominalStart: number;
  nominalEnd: number;
  drawnStart: number;
  drawnEnd: number;
  drawnWidth: number;
  expectedPhysicalWidth: number;
  depth: number;
}

export interface JointContractReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
