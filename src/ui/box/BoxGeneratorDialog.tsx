// BoxGeneratorDialog — the Phase K parametric finger-joint box form.
// Draft parsing and validation stay synchronous; geometry runs in a dedicated,
// cancellable worker so expensive valid values never execute during render.

import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { deriveBoxDims, type BoxPanel, type BoxSpec, type BoxSpecValidation } from '../../core/box';
import { persistCalibrationDraft } from '../calibration/calibration-draft-storage';
import { Button, Dialog, DialogActions } from '../kit';
import {
  BOX_DRAFT_KEY,
  BOX_FIELD_LABELS,
  type BoxDraftParse,
  type BoxMachineContext,
} from './box-draft';
import { BoxGenerationStatus } from './BoxGenerationStatus';
import { BoxGeneratorFields } from './BoxGeneratorFields';
import { BoxGeneratorPreview, type BoxPreviewView } from './BoxGeneratorPreview';
import { boxPreviewShouldBeSuppressed } from './box-preview-responsiveness';
import {
  useBoxGeneration,
  type BoxGenerationSnapshot,
  type BoxGenerationState,
} from './use-box-generation';
import { useBoxDraftClose } from './use-box-draft-close';
import { useBoxGeneratorForm } from './use-box-generator-form';

export function BoxGeneratorDialog(props: {
  readonly machine: BoxMachineContext;
  readonly onCancel: () => void;
  readonly onGenerate: (panels: ReadonlyArray<BoxPanel>) => void;
}): JSX.Element {
  const form = useBoxGeneratorForm(props.machine);
  const [view, setView] = useState<BoxPreviewView>('flat');
  const lastReady = useRef<BoxGenerationSnapshot | null>(null);
  const generation = useBoxGeneration(form.validSpec);
  const persistAndClose = useBoxDraftClose(form.draft, props.onCancel);
  if (generation.currentSnapshot !== null) lastReady.current = generation.currentSnapshot;
  const displayedSnapshot = generation.currentSnapshot ?? lastReady.current;
  const isPreviewSuppressed =
    displayedSnapshot !== null && boxPreviewShouldBeSuppressed(displayedSnapshot.metrics);

  const cancelGeneration = generation.cancel;
  const handleCancel = useCallback(() => {
    cancelGeneration();
    persistAndClose();
  }, [cancelGeneration, persistAndClose]);

  return (
    <Dialog
      onClose={handleCancel}
      title="Box Generator"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (generation.currentSnapshot === null) return;
        persistCalibrationDraft(BOX_DRAFT_KEY, form.draft);
        props.onGenerate(generation.currentSnapshot.panels);
      }}
      size="md"
    >
      <BoxGeneratorFields draft={form.draft} machine={props.machine} setField={form.setField} />
      <p style={summaryStyle}>
        {summaryLine(displayedSnapshot, generation.currentSnapshot, form.validSpec)}
      </p>
      <BoxGeneratorPreview
        view={view}
        onSelectView={setView}
        snapshot={displayedSnapshot}
        isPending={generation.state.kind === 'pending'}
      />
      <BoxGenerationStatus
        state={generation.state}
        staleMessage={stalePreviewMessage(
          form.parsed,
          form.validation,
          displayedSnapshot,
          generation.currentSnapshot,
          generation.state,
        )}
        isPreviewSuppressed={isPreviewSuppressed}
        onCancel={cancelGeneration}
        onRetry={generation.retry}
      />
      <IssueList
        issues={issueLines(form.parsed, form.validation, generation.state)}
        warnings={warningLines(form.validation)}
      />
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={generation.currentSnapshot === null}>
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
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

function issueLines(
  parsed: BoxDraftParse,
  validation: BoxSpecValidation | null,
  generation: BoxGenerationState,
): string[] {
  if (parsed.kind === 'incomplete') {
    return parsed.emptyFields.map((field) => `${BOX_FIELD_LABELS[field]}: Enter a value.`);
  }
  if (validation?.kind === 'invalid') {
    return validation.issues.map((issue) => `${BOX_FIELD_LABELS[issue.field]}: ${issue.message}`);
  }
  if (generation.kind !== 'failed') return [];
  if (generation.failure.kind === 'invalid') {
    return generation.failure.issues.map(
      (issue) => `${BOX_FIELD_LABELS[issue.field]}: ${issue.message}`,
    );
  }
  return [generation.failure.message];
}

function warningLines(validation: BoxSpecValidation | null): string[] {
  if (validation === null) return [];
  return validation.warnings.map(
    (warning) => `${BOX_FIELD_LABELS[warning.field]}: ${warning.message}`,
  );
}

function stalePreviewMessage(
  parsed: BoxDraftParse,
  validation: BoxSpecValidation | null,
  displayed: BoxGenerationSnapshot | null,
  current: BoxGenerationSnapshot | null,
  generation: BoxGenerationState,
): string | null {
  if (displayed === null || current !== null) return null;
  if (parsed.kind === 'incomplete') {
    return 'Showing last generated preview; current values are incomplete.';
  }
  if (validation?.kind === 'invalid') {
    return 'Showing last generated preview; current values are invalid.';
  }
  if (generation.kind === 'pending') {
    return 'Showing last generated preview while current values generate.';
  }
  if (generation.kind === 'failed') {
    return 'Showing last generated preview; current values could not be generated.';
  }
  if (generation.kind === 'cancelled') {
    return 'Showing last generated preview; current generation was cancelled.';
  }
  return 'Showing last generated preview; current values are not generated yet.';
}

function summaryLine(
  displayed: BoxGenerationSnapshot | null,
  current: BoxGenerationSnapshot | null,
  validSpec: BoxSpec | null,
): string {
  const spec = displayed?.spec ?? validSpec;
  if (spec === null) return 'Enter valid dimensions to preview the sheet.';
  const label = displayed === null ? 'Requested' : current === null ? 'Last generated' : 'Current';
  const dims = deriveBoxDims(spec);
  return (
    `${label} · Outer ${fmt(dims.outerWidthMm)} × ${fmt(dims.outerDepthMm)} × ${fmt(dims.outerHeightMm)} mm · ` +
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
