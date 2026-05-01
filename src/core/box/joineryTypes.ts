/**
 * Clean-room V5 laser box joinery model.
 *
 * V5 is anchored to verified box-generator topology:
 * - OpenSCAD-style panels are rectangles with complementary edge cuts.
 * - TabbedBoxMaker-style direct path generation creates one clean closed
 *   contour per panel.
 * - A tab is the solid material left between socket cuts; socket cuts are the
 *   only geometry pushed inward from a panel edge.
 *
 * No GPL code is copied here. These are LaserForge-native types and algorithms.
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
  /**
   * For the primary edge, 'socket' intervals are cut inward.
   * For the secondary edge, the intervals are inverted.
   */
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

export interface JointEndpoint {
  panel: BoxPanelName;
  edge: BoxEdgeName;
  /**
   * Active joint start measured from the start of the rendered edge direction.
   * This is needed for depth-running top/bottom joints, which should start one
   * material thickness from the corner and span depth - 2*thickness.
   */
  start?: number;
}

export interface EdgeSpec {
  panel: BoxPanelName;
  edge: BoxEdgeName;
  jointId?: string;
  role: JointEdgeRole;
  /** Full panel-edge length. */
  length: number;
  /** Active physical joint span start along this edge. */
  jointStart: number;
  /** Active physical joint span length along this edge. */
  jointLength: number;
}

export interface JointSpec {
  id: string;
  length: number;
  primary: JointEndpoint;
  secondary: JointEndpoint;
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
  jointStart: number;
  jointLength: number;
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
