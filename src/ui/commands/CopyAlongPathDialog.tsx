// Copy Along Path dialog (LightBurn gap LBG-T09). A line under the settings
// says how many copies will land and how far apart, or why none can, from the
// same plan the store action carries out.

import { useDeferredValue, useMemo, useState } from 'react';
import { splitCopyAlongPathSelection } from '../../core/geometry/copy-along-path-guide';
import { combinedBBox } from '../../core/scene/hit-test';
import type { SceneObject } from '../../core/scene/scene-object';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import { Button, Dialog, DialogActions } from '../kit';
import {
  planForSelection,
  type CopyAlongPathPlan,
  type CopyAlongPathRequest,
} from '../state/copy-along-path-plan';
import {
  GuideField,
  OptionFields,
  PlacementFields,
  type CopyAlongPathForm,
} from './CopyAlongPathFields';

// The 2 mm matches the Array dialog's default spacing.
const DEFAULT_GAP_MM = 2;

export const DEFAULT_COPY_ALONG_PATH_FORM: CopyAlongPathForm = {
  mode: 'count',
  countText: '5',
  spacingText: '10',
  gapText: String(DEFAULT_GAP_MM),
  startText: '0',
  endText: '0',
  rotateCopies: true,
  keepOriginal: true,
};

/** The first form for a selection: the spacing leaves the default gap between copies. */
export function defaultCopyAlongPathForm(selected: ReadonlyArray<SceneObject>): CopyAlongPathForm {
  const selection = splitCopyAlongPathSelection(selected);
  const bounds = selection.kind === 'ok' ? combinedBBox(selection.artwork) : null;
  if (bounds === null) return DEFAULT_COPY_ALONG_PATH_FORM;
  const spacing = Math.round((bounds.maxX - bounds.minX + DEFAULT_GAP_MM) * 10) / 10;
  return { ...DEFAULT_COPY_ALONG_PATH_FORM, spacingText: String(spacing) };
}

export function CopyAlongPathDialog(props: {
  /** The selection, in stacking order. */
  readonly selected: ReadonlyArray<SceneObject>;
  readonly initial: CopyAlongPathForm;
  readonly onCancel: () => void;
  readonly onApply: (request: CopyAlongPathRequest, form: CopyAlongPathForm) => void;
}): JSX.Element {
  const [form, setForm] = useState(props.initial);
  const [guideId, setGuideId] = useState<string>();
  const selection = useMemo(
    () => splitCopyAlongPathSelection(props.selected, guideId),
    [props.selected, guideId],
  );
  const guide = selection.kind === 'ok' ? selection.guide : null;
  const request = useMemo(() => requestFromForm(form, guide?.object.id), [form, guide?.object.id]);
  const deferred = useDeferredValue(request);
  const plan = useMemo(() => planForSelection(selection, deferred), [selection, deferred]);
  const onChange = (patch: Partial<CopyAlongPathForm>): void =>
    setForm((current) => ({ ...current, ...patch }));
  return (
    <Dialog
      title="Copy Along Path"
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        if (plan.kind === 'ready') props.onApply(request, form);
      }}
    >
      <div style={fieldsStyle}>
        <GuideField
          guides={selection.kind === 'ok' ? selection.guides : []}
          guide={guide}
          onChange={setGuideId}
        />
        <PlacementFields form={form} closedGuide={guide?.closed === true} onChange={onChange} />
        <OptionFields form={form} onChange={onChange} />
      </div>
      <p role="status" aria-live="polite" style={statusStyle}>
        {plan.kind === 'ready' ? summary(plan, deferred) : plan.message}
      </p>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={plan.kind !== 'ready'}>
          Copy along path
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function requestFromForm(
  form: CopyAlongPathForm,
  guideId: string | undefined,
): CopyAlongPathRequest {
  return {
    mode: form.mode,
    count: Math.max(1, Math.floor(numberOr(form.countText, 1))),
    spacingMm:
      form.mode === 'gap' ? Math.max(0, numberOr(form.gapText, 0)) : numberOr(form.spacingText, 0),
    startOffsetMm: Math.max(0, numberOr(form.startText, 0)),
    endOffsetMm: Math.max(0, numberOr(form.endText, 0)),
    rotateCopies: form.rotateCopies,
    keepOriginal: form.keepOriginal,
    ...(guideId === undefined ? {} : { guideId }),
  };
}

function summary(
  plan: Extract<CopyAlongPathPlan, { kind: 'ready' }>,
  request: CopyAlongPathRequest,
): string {
  const count = plan.placements.length;
  const copies = count === 1 ? '1 copy' : `${count} copies`;
  const { walk, closed } = plan.selection.guide;
  const length = formatDisplayMillimetres(walk.lengthMm);
  const where = closed
    ? `all the way round the ${length} mm guide`
    : `along the ${length} mm guide`;
  const apart =
    count < 2
      ? ''
      : plan.stepMm !== null
        ? `, ${formatDisplayMillimetres(plan.stepMm)} mm apart centre to centre`
        : `, ${formatDisplayMillimetres(request.spacingMm)} mm between edges`;
  const original = request.keepOriginal ? '' : ' The original will be removed.';
  return `Places ${copies} ${where}${apart}.${original}`;
}

function numberOr(text: string, fallback: number): number {
  if (text.trim() === '') return fallback;
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}

const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 10, marginBottom: 10 };
const statusStyle: React.CSSProperties = { fontSize: 13 };
