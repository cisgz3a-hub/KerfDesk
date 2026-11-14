// The camera picture is drawn at one height: the overlay's Material height
// (ADR-441 Amendment 13, camera audit v2 K2-P1-2, K2-P2-1 and K1-P2-2). It
// lines up with what lies on the bed only at that height, and it starts at
// 0 mm each session. Three things the project knows can say it is wrong:
// - on a rotary, the part's top is at least its diameter up (the axis height
//   plus half the diameter): an 80 mm tumbler drawn at 0 burned 17-32 mm
//   along its length from where the picture showed the artwork;
// - the job's material has a thickness: 6 mm stock drawn at 0 was 5 mm off
//   at the front corners, 18 mm stock 16 mm;
// - a calibration "lined up at the height of the target sheet only" does not
//   know the camera's height, so at any other Material height its picture
//   was 1-17 mm off.
// These are said, never applied: the Material height stays the operator's
// setting (ADR-441 Amendment 2, Decision 5).

import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import { rotaryAppliesTo } from '../../core/job';
import type { Project } from '../../core/scene';

/** A Material height within this of the expected one is taken as set. */
export const HEIGHT_TOLERANCE_MM = 1;

export type CameraHeightIssue =
  /** On a rotary the picture lines up with the part only at its top. */
  | { readonly kind: 'rotary'; readonly surfaceHeightMm: number; readonly diameterMm: number }
  /** The job's material is this thick. */
  | { readonly kind: 'material'; readonly surfaceHeightMm: number; readonly thicknessMm: number }
  /** The calibration lines up only at its target's height. */
  | {
      readonly kind: 'target-height-only';
      readonly surfaceHeightMm: number;
      readonly targetHeightMm: number;
    };

export type CameraHeightFacts = {
  readonly surfaceHeightMm: number;
  /** The rotary's object diameter while a rotary applies to the job, else null. */
  readonly rotaryDiameterMm: number | null;
  /** The job material's thickness, when the project names one. */
  readonly materialThicknessMm: number | undefined;
  /** The calibration's target height when it lines up only there, else null. */
  readonly onlyAtTargetHeightMm: number | null;
};

/** The facts the height rule weighs, from the project, the overlay and its calibration. */
export function cameraHeightFacts(
  project: Pick<Project, 'device' | 'machine' | 'jobSetup'>,
  surfaceHeightMm: number,
  calibration: CameraModelRecord | null | undefined,
): CameraHeightFacts {
  const setup = project.device.rotary;
  const rotary = rotaryAppliesTo(project.device, project.machine) && setup !== undefined;
  const accuracy = calibration?.accuracy;
  return {
    surfaceHeightMm,
    rotaryDiameterMm: rotary ? setup.objectDiameterMm : null,
    materialThicknessMm: project.jobSetup.laserMaterial?.thicknessMm,
    onlyAtTargetHeightMm: accuracy?.onlyAtTargetHeight === true ? accuracy.targetHeightMm : null,
  };
}

/** What the Material height disagrees with, most important first. */
export function cameraHeightIssues(facts: CameraHeightFacts): CameraHeightIssue[] {
  const height = facts.surfaceHeightMm;
  const issues: CameraHeightIssue[] = [];
  // The top of a part turned by a rotary cannot be lower than its diameter.
  if (facts.rotaryDiameterMm !== null && height + HEIGHT_TOLERANCE_MM < facts.rotaryDiameterMm) {
    issues.push({ kind: 'rotary', surfaceHeightMm: height, diameterMm: facts.rotaryDiameterMm });
  }
  const thickness = facts.materialThicknessMm;
  if (
    facts.rotaryDiameterMm === null &&
    thickness !== undefined &&
    thickness > 0 &&
    Math.abs(height - thickness) > HEIGHT_TOLERANCE_MM
  ) {
    issues.push({ kind: 'material', surfaceHeightMm: height, thicknessMm: thickness });
  }
  const target = facts.onlyAtTargetHeightMm;
  if (target !== null && Math.abs(height - target) > HEIGHT_TOLERANCE_MM) {
    issues.push({ kind: 'target-height-only', surfaceHeightMm: height, targetHeightMm: target });
  }
  return issues;
}

const mm = (value: number): string => `${Math.round(value * 10) / 10} mm`;

/** Job Review's sentence for an issue. */
export function cameraHeightJobWarning(issue: CameraHeightIssue): string {
  switch (issue.kind) {
    case 'rotary':
      return `Camera placement is on, and so is the rotary: the camera picture lines up with the part only at the part's top, but it is drawn at a Material height of ${mm(issue.surfaceHeightMm)}. The top of a ${mm(issue.diameterMm)} part is at least ${mm(issue.diameterMm)} above the bed (the rotary's axis height plus half the diameter), so the job may burn tens of millimetres along the part from where it shows. Set Material height in the Camera panel to the height of the part's top, and watch the Frame.`;
    case 'material':
      return `Camera placement is on, but the camera picture is drawn at a Material height of ${mm(issue.surfaceHeightMm)} while this job's material is ${mm(issue.thicknessMm)} thick, so the job may burn millimetres from where it shows on the picture. Set Material height in the Camera panel to ${mm(issue.thicknessMm)}, and watch the Frame.`;
    case 'target-height-only':
      return `Camera placement is on, but the camera calibration lines up only at the height of its target sheet (${mm(issue.targetHeightMm)}), and the picture is drawn at a Material height of ${mm(issue.surfaceHeightMm)}, where it may be millimetres off. Calibrate again with the camera's height typed in, or work at ${mm(issue.targetHeightMm)}, and watch the Frame.`;
  }
}

/** The short note under the Material height control. */
export function cameraHeightNote(issue: CameraHeightIssue): string {
  switch (issue.kind) {
    case 'rotary':
      return `The rotary is on: set this to the height of the part's top, at least ${mm(issue.diameterMm)} for this part.`;
    case 'material':
      return `This job's material is ${mm(issue.thicknessMm)} thick.`;
    case 'target-height-only':
      return `This calibration lines up only at its target's height, ${mm(issue.targetHeightMm)}. Calibrate again with the camera's height typed in to use other heights.`;
  }
}
