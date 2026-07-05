// BoxGeneratorDialog — the Phase K parametric finger-joint box form
// (ADR-106, F-K1..F-K5): string drafts with calibration-dialog persistence,
// live validation via the pure core, machine-aware defaults, and a preview
// that keeps the last valid sheet while the draft is invalid. Generation is
// disabled unless the core says the spec is valid.

import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  deriveBoxDims,
  generateBox,
  validateBoxSpec,
  type BoxPanel,
  type GenerateBoxResult,
} from '../../core/box';
import { Button, Dialog, DialogActions } from '../kit';
import {
  persistCalibrationDraft,
  restoreCalibrationDraft,
} from '../calibration/calibration-draft-storage';
import {
  BOX_DRAFT_KEY,
  BOX_DRAFT_PERSISTED_FIELDS,
  BOX_FIELD_LABELS,
  boxDraftWithMaterialThickness,
  defaultBoxDraft,
  parseBoxDraft,
  type BoxAutoFitField,
  type BoxDraft,
  type BoxDraftParse,
  type BoxMachineContext,
} from './box-draft';
import { BoxGeneratorFields } from './BoxGeneratorFields';
import { BoxPreview } from './BoxPreview';

export function BoxGeneratorDialog(props: {
  readonly machine: BoxMachineContext;
  readonly onCancel: () => void;
  readonly onGenerate: (panels: ReadonlyArray<BoxPanel>) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(() =>
    restoreCalibrationDraft(
      BOX_DRAFT_KEY,
      defaultBoxDraft(props.machine),
      BOX_DRAFT_PERSISTED_FIELDS,
    ),
  );
  const [lockedAutoFitFields, setLockedAutoFitFields] = useState<ReadonlySet<BoxAutoFitField>>(
    () => new Set(),
  );
  // Keeps the last valid sheet visible while the draft is invalid (F-K1).
  // Render-time ref write is an idempotent cache, safe under StrictMode.
  const lastValidPanels = useRef<ReadonlyArray<BoxPanel> | null>(null);
  const setField =
    (field: keyof BoxDraft) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      const { value } = event.target;
      setDraft((current) =>
        field === 'thickness'
          ? boxDraftWithMaterialThickness(current, value, lockedAutoFitFields)
          : { ...current, [field]: value },
      );
      if (isAutoFitField(field)) {
        setLockedAutoFitFields((current) => new Set([...current, field]));
      }
    };
  const parsed = parseBoxDraft(draft, props.machine);
  const generation = parsed.kind === 'spec' ? generateBox(parsed.spec) : null;
  const panels = generation !== null && generation.kind === 'generated' ? generation.panels : null;
  if (panels !== null) lastValidPanels.current = panels;
  return (
    <Dialog
      onClose={props.onCancel}
      title="Box Generator"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (panels === null) return;
        persistCalibrationDraft(BOX_DRAFT_KEY, draft);
        props.onGenerate(panels);
      }}
      size="md"
    >
      <BoxGeneratorFields draft={draft} machine={props.machine} setField={setField} />
      <p style={summaryStyle}>{summaryLine(parsed)}</p>
      <BoxPreview panels={panels ?? lastValidPanels.current} />
      <IssueList issues={issueLines(parsed, generation)} warnings={warningLines(parsed)} />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={panels === null}>
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function isAutoFitField(field: keyof BoxDraft): field is BoxAutoFitField {
  return field === 'fingerWidth' || field === 'partSpacing';
}

function IssueList(props: {
  readonly issues: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}): JSX.Element | null {
  if (props.issues.length === 0 && props.warnings.length === 0) return null;
  return (
    <div role="alert" style={issueBlockStyle}>
      {props.issues.map((issue) => (
        <p key={issue} style={issueStyle}>
          {issue}
        </p>
      ))}
      {props.warnings.map((warning) => (
        <p key={warning} style={warningStyle}>
          {warning}
        </p>
      ))}
    </div>
  );
}

function issueLines(parsed: BoxDraftParse, generation: GenerateBoxResult | null): string[] {
  if (parsed.kind === 'incomplete') {
    return parsed.emptyFields.map((field) => `${BOX_FIELD_LABELS[field]}: Enter a value.`);
  }
  if (generation === null) return [];
  if (generation.kind === 'invalid') {
    return generation.issues.map((issue) => `${BOX_FIELD_LABELS[issue.field]}: ${issue.message}`);
  }
  if (generation.kind === 'error') return [generation.message];
  return [];
}

// Warnings (e.g. finger under twice the relief tool) surface even when the
// spec is valid, so they come from validation, not the generation result.
function warningLines(parsed: BoxDraftParse): string[] {
  if (parsed.kind !== 'spec') return [];
  const validation = validateBoxSpec(parsed.spec);
  return validation.warnings.map(
    (warning) => `${BOX_FIELD_LABELS[warning.field]}: ${warning.message}`,
  );
}

function summaryLine(parsed: BoxDraftParse): string {
  if (parsed.kind !== 'spec') return 'Enter all dimensions to preview the sheet.';
  const dims = deriveBoxDims(parsed.spec);
  return (
    `Outer ${fmt(dims.outerWidthMm)} × ${fmt(dims.outerDepthMm)} × ${fmt(dims.outerHeightMm)} mm · ` +
    `Inner ${fmt(dims.innerWidthMm)} × ${fmt(dims.innerDepthMm)} × ${fmt(dims.innerHeightMm)} mm`
  );
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const summaryStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  margin: '8px 0 6px',
};

const issueBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginTop: 6,
};

const issueStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-danger-fg)',
  margin: 0,
};

const warningStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-warning-fg)',
  margin: 0,
};
