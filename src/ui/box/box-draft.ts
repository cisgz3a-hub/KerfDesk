// box-draft — the Box Generator dialog's string draft model (ADR-106):
// machine-aware defaults, draft→spec parsing with explicit empty-field
// reporting (F-K1 empty state), and the persistence field list. String
// drafts keep half-typed numbers editable; the spec is derived per render.

import type { BoxSpec, BoxSpecField } from '../../core/box';

export type BoxMachineContext =
  | { readonly kind: 'laser' }
  | { readonly kind: 'cnc'; readonly stockThicknessMm: number; readonly toolDiameterMm: number };

export type BoxDraft = {
  readonly width: string;
  readonly depth: string;
  readonly height: string;
  readonly mode: string;
  readonly style: string;
  readonly thickness: string;
  readonly fingerWidth: string;
  readonly clearance: string;
  readonly partSpacing: string;
  readonly toolDiameter: string;
  // CNC corner relief (dogbones). 'off' (default) = sharp finger corners; 'on'
  // = bit-radius overcuts so tabs seat fully in a round-bit slot — opt in when
  // a joint won't close. Ignored in laser mode (a kerf has no corner limit).
  readonly relief: string;
};

export const BOX_DRAFT_KEY = 'laserforge.box.generatorDraft.v1';

// The relief tool diameter is never persisted: the bit currently in the
// machine is the truth, and a stale stored diameter would silently mis-size
// every relief. Everything else follows the calibration-draft convention
// (F-K5: reopening restores the last-entered values).
export const BOX_DRAFT_PERSISTED_FIELDS: ReadonlyArray<keyof BoxDraft> = [
  'width',
  'depth',
  'height',
  'mode',
  'style',
  'thickness',
  'fingerWidth',
  'clearance',
  'partSpacing',
  'relief',
];

// CNC glue fit vs laser press fit (ADR-106 fit division of labor).
const CNC_DEFAULT_CLEARANCE_MM = 0.15;
const DEFAULT_LASER_THICKNESS_MM = 3;
const FINGER_WIDTH_TO_THICKNESS = 3;
const PART_SPACING_TO_THICKNESS = 2;
const MIN_PART_SPACING_MM = 8;

export type BoxAutoFitField = 'fingerWidth' | 'partSpacing';

export function defaultBoxDraft(machine: BoxMachineContext): BoxDraft {
  const thicknessMm = defaultMaterialThicknessMm(machine);
  const autoFit = boxAutoFitDefaults(thicknessMm);
  return {
    width: '60',
    depth: '40',
    height: '30',
    mode: 'inner',
    style: 'closed',
    thickness: fmtDraftMm(thicknessMm),
    fingerWidth: autoFit.fingerWidth,
    clearance: machine.kind === 'cnc' ? String(CNC_DEFAULT_CLEARANCE_MM) : '0',
    partSpacing: autoFit.partSpacing,
    toolDiameter: machine.kind === 'cnc' ? String(machine.toolDiameterMm) : '',
    relief: 'off',
  };
}

export function boxDraftWithMaterialThickness(
  draft: BoxDraft,
  thickness: string,
  lockedAutoFitFields: ReadonlySet<BoxAutoFitField>,
): BoxDraft {
  const next: BoxDraft = { ...draft, thickness };
  const thicknessMm = Number(thickness);
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) return next;
  const autoFit = boxAutoFitDefaults(thicknessMm);
  return {
    ...next,
    fingerWidth: lockedAutoFitFields.has('fingerWidth') ? next.fingerWidth : autoFit.fingerWidth,
    partSpacing: lockedAutoFitFields.has('partSpacing') ? next.partSpacing : autoFit.partSpacing,
  };
}

function defaultMaterialThicknessMm(machine: BoxMachineContext): number {
  return machine.kind === 'cnc' ? machine.stockThicknessMm : DEFAULT_LASER_THICKNESS_MM;
}

function boxAutoFitDefaults(thicknessMm: number): Pick<BoxDraft, 'fingerWidth' | 'partSpacing'> {
  return {
    fingerWidth: fmtDraftMm(thicknessMm * FINGER_WIDTH_TO_THICKNESS),
    partSpacing: fmtDraftMm(Math.max(MIN_PART_SPACING_MM, thicknessMm * PART_SPACING_TO_THICKNESS)),
  };
}

function fmtDraftMm(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export type BoxDraftParse =
  | { readonly kind: 'spec'; readonly spec: BoxSpec }
  | { readonly kind: 'incomplete'; readonly emptyFields: ReadonlyArray<BoxSpecField> };

export function parseBoxDraft(draft: BoxDraft, machine: BoxMachineContext): BoxDraftParse {
  const required: ReadonlyArray<readonly [BoxSpecField, string]> = [
    ['width', draft.width],
    ['depth', draft.depth],
    ['height', draft.height],
    ['thickness', draft.thickness],
    ['fingerWidth', draft.fingerWidth],
    ['clearance', draft.clearance],
    ['partSpacing', draft.partSpacing],
    // The relief tool diameter is only needed when corner relief is on.
    ...(machine.kind === 'cnc' && draft.relief !== 'off'
      ? ([['reliefTool', draft.toolDiameter]] as const)
      : []),
  ];
  const emptyFields = required.filter(([, value]) => value.trim() === '').map(([field]) => field);
  if (emptyFields.length > 0) return { kind: 'incomplete', emptyFields };
  return {
    kind: 'spec',
    spec: {
      widthMm: Number(draft.width),
      depthMm: Number(draft.depth),
      heightMm: Number(draft.height),
      dimensionMode: draft.mode === 'outer' ? 'outer' : 'inner',
      thicknessMm: Number(draft.thickness),
      targetFingerWidthMm: Number(draft.fingerWidth),
      style: draft.style === 'open-top' ? 'open-top' : 'closed',
      clearanceMm: Number(draft.clearance),
      relief:
        machine.kind === 'cnc' && draft.relief !== 'off'
          ? { kind: 'corner-overcut', toolDiameterMm: Number(draft.toolDiameter) }
          : { kind: 'none' },
      partSpacingMm: Number(draft.partSpacing),
    },
  };
}

export const BOX_FIELD_LABELS: Readonly<Record<BoxSpecField, string>> = {
  width: 'Width',
  depth: 'Depth',
  height: 'Height',
  thickness: 'Material thickness (mm)',
  fingerWidth: 'Finger width',
  clearance: 'Clearance',
  reliefTool: 'Relief tool diameter',
  partSpacing: 'Part spacing',
};
