// runPreflight — runs WORKFLOW.md F-A10's six pre-write checks against a
// Project and its emitted G-code. Returns a list of issues; an empty list
// means safe-to-write. Pure: no I/O.
//
// Checks (per WORKFLOW.md F-A10, in order):
//   1. At least one output layer exists.
//   2. All output geometry fits inside the bed.
//   3. Power values within 0..100 for every output layer.
//   4. Speed values within (0, device.maxFeed].
//   5. Passes ≥ 1 (integer) for every output layer.
//   6. Generated G-code is non-empty (at least one G1 line).
//
// Phase A scope: bounds check supports front-left/right and rear-left/right
// origins (positive coord range). Center origin is documented as Phase B.

import type { Layer } from '../scene';
import type { Project } from '../scene';
import { findOutOfBoundsCoords } from '../invariants';

export type PreflightCode =
  | 'no-output-layer'
  | 'out-of-bed'
  | 'power-out-of-range'
  | 'speed-out-of-range'
  | 'passes-below-one'
  | 'empty-output';

export type PreflightIssue = {
  readonly code: PreflightCode;
  readonly message: string;
};

export type PreflightResult = {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<PreflightIssue>;
};

const MAX_BOUNDS_ISSUES = 5;

export function runPreflight(project: Project, gcode: string): PreflightResult {
  const issues: PreflightIssue[] = [];
  const outputLayers = project.scene.layers.filter((l) => l.output);

  if (outputLayers.length === 0) {
    issues.push({
      code: 'no-output-layer',
      message: 'No output layers. Enable Output on at least one layer.',
    });
  }

  for (const layer of outputLayers) {
    appendLayerIssues(layer, project.device.maxFeed, issues);
  }

  appendBoundsIssues(project, gcode, issues);

  if (!/\bG1\b/.test(gcode)) {
    issues.push({
      code: 'empty-output',
      message: 'Internal error: G-code generation produced no cuts.',
    });
  }

  return { ok: issues.length === 0, issues };
}

function appendLayerIssues(layer: Layer, maxFeed: number, issues: PreflightIssue[]): void {
  if (layer.power < 0 || layer.power > 100) {
    issues.push({
      code: 'power-out-of-range',
      message: `Layer ${layer.id} power ${layer.power} is outside 0..100.`,
    });
  }
  if (layer.speed <= 0 || layer.speed > maxFeed) {
    issues.push({
      code: 'speed-out-of-range',
      message: `Layer ${layer.id} speed ${layer.speed} exceeds device max ${maxFeed}.`,
    });
  }
  if (!Number.isInteger(layer.passes) || layer.passes < 1) {
    issues.push({
      code: 'passes-below-one',
      message: `Layer ${layer.id} passes ${layer.passes} must be an integer ≥ 1.`,
    });
  }
}

function appendBoundsIssues(project: Project, gcode: string, issues: PreflightIssue[]): void {
  if (project.device.origin === 'center') {
    // Phase B will support bounds checking with negative-coord rectangles.
    return;
  }
  const oob = findOutOfBoundsCoords(gcode, {
    width: project.device.bedWidth,
    height: project.device.bedHeight,
  });
  for (const issue of oob.slice(0, MAX_BOUNDS_ISSUES)) {
    issues.push({
      code: 'out-of-bed',
      message: `Line ${issue.lineNumber}: ${issue.reason}`,
    });
  }
}
