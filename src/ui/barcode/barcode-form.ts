// Barcode dialog form state (ADR-372). Numbers stay as typed until they
// parse, and the preview evaluates variable data the way output does, so the
// dialog shows the code the job would engrave, or the reason it cannot.

import {
  BARCODE_LIMITS,
  defaultBarcodeSpec,
  isMatrixSymbology,
  layoutBarcode,
  type BarcodeLayout,
  type BarcodeShape,
  type BarcodeSymbology,
} from '../../core/barcode';
import type { Project, SceneObject } from '../../core/scene';
import { evaluateVariableTemplate, parseVariableTemplateSource } from '../../core/variables';

export type BarcodeNumberField = 'moduleMm' | 'widthMm' | 'barHeightMm' | 'quietZoneModules';

export type BarcodeDraft = {
  readonly symbology: BarcodeSymbology;
  readonly data: string;
  readonly variable: boolean;
  readonly errorCorrection: BarcodeShape['errorCorrection'];
  readonly sizeMode: BarcodeShape['sizeMode'];
  readonly moduleMm: string;
  readonly widthMm: string;
  readonly barHeightMm: string;
  readonly quietZoneModules: string;
  readonly invert: boolean;
  readonly showText: boolean;
  /** An edited array copy keeps its place in the serial/record sequence. */
  readonly sequenceOffset?: number;
};

export type BarcodePreview =
  | {
      readonly kind: 'ready';
      readonly spec: BarcodeShape;
      /** The value the preview encodes, which the inserted object draws. */
      readonly value: string;
      readonly layout: BarcodeLayout;
      readonly notes: readonly string[];
    }
  | { readonly kind: 'invalid'; readonly message: string };

export type BarcodePreviewContext = {
  readonly project: Project;
  /** The edited barcode, or a stand-in when inserting; variable fields read its operation. */
  readonly object: SceneObject;
  readonly now: Date;
};

const NUMBER_FIELDS: Readonly<
  Record<
    BarcodeNumberField,
    {
      readonly label: string;
      readonly unit: string;
      readonly range: { readonly min: number; readonly max: number };
    }
  >
> = {
  moduleMm: { label: 'Module size', unit: 'mm', range: BARCODE_LIMITS.moduleMm },
  widthMm: { label: 'Width', unit: 'mm', range: BARCODE_LIMITS.widthMm },
  barHeightMm: { label: 'Bar height', unit: 'mm', range: BARCODE_LIMITS.barHeightMm },
  quietZoneModules: {
    label: 'Quiet zone',
    unit: 'modules',
    range: BARCODE_LIMITS.quietZoneModules,
  },
};

export function draftFromSpec(spec: BarcodeShape): BarcodeDraft {
  const offset = spec.variableTemplate?.sequenceOffset;
  return {
    symbology: spec.symbology,
    data: spec.data,
    variable: spec.variableTemplate !== undefined,
    errorCorrection: spec.errorCorrection,
    sizeMode: spec.sizeMode,
    moduleMm: String(spec.moduleMm),
    widthMm: String(spec.widthMm),
    barHeightMm: String(spec.barHeightMm),
    quietZoneModules: String(spec.quietZoneModules),
    invert: spec.invert,
    showText: spec.showText,
    ...(offset === undefined ? {} : { sequenceOffset: offset }),
  };
}

/**
 * Switching type keeps the operator's data and options. Untouched sample
 * data follows the new type, the quiet zone resets to its standard, and the
 * size resets when moving between 2D and 1D codes, whose modules differ.
 */
export function draftWithSymbology(draft: BarcodeDraft, symbology: BarcodeSymbology): BarcodeDraft {
  if (draft.symbology === symbology) return draft;
  const before = defaultBarcodeSpec(draft.symbology);
  const after = defaultBarcodeSpec(symbology);
  const sameFamily = isMatrixSymbology(symbology) === isMatrixSymbology(draft.symbology);
  return {
    ...draft,
    symbology,
    data: draft.data === before.data ? after.data : draft.data,
    quietZoneModules: String(after.quietZoneModules),
    ...(sameFamily ? {} : { moduleMm: String(after.moduleMm), widthMm: String(after.widthMm) }),
  };
}

export type BarcodeFormResult =
  | { readonly ok: true; readonly spec: BarcodeShape }
  | { readonly ok: false; readonly message: string };

export function specFromDraft(draft: BarcodeDraft): BarcodeFormResult {
  const numbers = parseNumbers(draft);
  if (!numbers.ok) return numbers;
  const data = draft.data.normalize('NFC');
  const template = draft.variable ? parseVariableTemplateSource(data) : undefined;
  if (template !== undefined && !template.ok) return template;
  const variableTemplate =
    template === undefined
      ? undefined
      : draft.sequenceOffset === undefined
        ? template.template
        : { ...template.template, sequenceOffset: draft.sequenceOffset };
  return {
    ok: true,
    spec: {
      kind: 'barcode',
      symbology: draft.symbology,
      data,
      ...(variableTemplate === undefined ? {} : { variableTemplate }),
      errorCorrection: draft.errorCorrection,
      sizeMode: draft.sizeMode,
      ...numbers.values,
      invert: draft.invert,
      showText: draft.showText,
    },
  };
}

export function previewBarcode(
  draft: BarcodeDraft,
  context: BarcodePreviewContext,
): BarcodePreview {
  const form = specFromDraft(draft);
  if (!form.ok) return { kind: 'invalid', message: form.message };
  const value = previewValue(form.spec, context);
  const laid = layoutBarcode(form.spec, value.value);
  if (!laid.ok) {
    const prefix = value.evaluated ? `The current value "${value.value}" cannot be encoded. ` : '';
    return { kind: 'invalid', message: prefix + laid.message };
  }
  return {
    kind: 'ready',
    spec: form.spec,
    value: value.value,
    layout: laid.layout,
    notes: value.notes,
  };
}

/** Which size fields the current type and size mode use. */
export function activeNumberFields(draft: BarcodeDraft): readonly BarcodeNumberField[] {
  return [
    draft.sizeMode === 'module' ? 'moduleMm' : 'widthMm',
    ...(isMatrixSymbology(draft.symbology) ? [] : (['barHeightMm'] as const)),
    'quietZoneModules',
  ];
}

function parseNumbers(
  draft: BarcodeDraft,
):
  | { readonly ok: true; readonly values: Pick<BarcodeShape, BarcodeNumberField> }
  | { readonly ok: false; readonly message: string } {
  const active = new Set(activeNumberFields(draft));
  const defaults = defaultBarcodeSpec(draft.symbology);
  const values: Record<BarcodeNumberField, number> = {
    moduleMm: defaults.moduleMm,
    widthMm: defaults.widthMm,
    barHeightMm: defaults.barHeightMm,
    quietZoneModules: defaults.quietZoneModules,
  };
  for (const field of Object.keys(NUMBER_FIELDS) as BarcodeNumberField[]) {
    const parsed = parseNumber(field, draft[field]);
    // A field the current settings hide keeps a valid value for later.
    if (parsed === null && active.has(field)) return { ok: false, message: rangeMessage(field) };
    values[field] = parsed ?? defaults[field];
  }
  return { ok: true, values };
}

function parseNumber(field: BarcodeNumberField, text: string): number | null {
  const value = Number(text.trim());
  const { range } = NUMBER_FIELDS[field];
  if (text.trim() === '' || !Number.isFinite(value)) return null;
  if (value < range.min || value > range.max) return null;
  if (field === 'quietZoneModules' && !Number.isInteger(value)) return null;
  return value;
}

function rangeMessage(field: BarcodeNumberField): string {
  const { label, unit, range } = NUMBER_FIELDS[field];
  const whole = field === 'quietZoneModules' ? 'a whole number ' : '';
  return `${label} must be ${whole}from ${range.min} to ${range.max} ${unit}.`;
}

function previewValue(
  spec: BarcodeShape,
  context: BarcodePreviewContext,
): { readonly value: string; readonly evaluated: boolean; readonly notes: readonly string[] } {
  const template = spec.variableTemplate;
  if (template === undefined) return { value: spec.data, evaluated: false, notes: [] };
  const evaluated = evaluateVariableTemplate(template, context.object, context.project, {
    now: context.now,
  });
  if (evaluated.ok) {
    return {
      value: evaluated.value,
      evaluated: true,
      notes: [`Previewing "${evaluated.value}". Each copy and each output encodes its own value.`],
    };
  }
  return {
    value: defaultBarcodeSpec(spec.symbology).data,
    evaluated: false,
    notes: [
      `${evaluated.message} Until then the preview shows sample data; output encodes the real value or stops with an error.`,
    ],
  };
}
