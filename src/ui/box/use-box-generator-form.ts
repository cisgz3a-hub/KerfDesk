import { useMemo, useState, type ChangeEvent } from 'react';
import { validateBoxSpec, type BoxSpec, type BoxSpecValidation } from '../../core/box';
import {
  BOX_DRAFT_KEY,
  BOX_DRAFT_PERSISTED_FIELDS,
  SLIDE_LID_MIN_CLEARANCE_DRAFT,
  boxDraftWithMaterialThickness,
  defaultBoxDraft,
  parseBoxDraft,
  type BoxAutoFitField,
  type BoxDraft,
  type BoxDraftParse,
  type BoxMachineContext,
} from './box-draft';
import { restoreCalibrationDraft } from '../calibration/calibration-draft-storage';
import type { BoxFieldSetter } from './BoxGeneratorFields';

export function useBoxGeneratorForm(machine: BoxMachineContext): {
  readonly draft: BoxDraft;
  readonly parsed: BoxDraftParse;
  readonly validation: BoxSpecValidation | null;
  readonly validSpec: BoxSpec | null;
  readonly setField: BoxFieldSetter;
} {
  const [draft, setDraft] = useState(() =>
    restoreCalibrationDraft(BOX_DRAFT_KEY, defaultBoxDraft(machine), BOX_DRAFT_PERSISTED_FIELDS),
  );
  const [lockedAutoFitFields, setLockedAutoFitFields] = useState<ReadonlySet<BoxAutoFitField>>(
    () => new Set(),
  );
  const parsed = useMemo(() => parseBoxDraft(draft, machine), [draft, machine]);
  const validation = useMemo(
    () => (parsed.kind === 'spec' ? validateBoxSpec(parsed.spec) : null),
    [parsed],
  );
  const setField =
    (field: keyof BoxDraft) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      const { value } = event.target;
      setDraft((current) => updateDraftField(current, field, value, lockedAutoFitFields));
      if (isAutoFitField(field)) {
        setLockedAutoFitFields((current) => new Set([...current, field]));
      }
    };
  return {
    draft,
    parsed,
    validation,
    validSpec: parsed.kind === 'spec' && validation?.kind === 'valid' ? parsed.spec : null,
    setField,
  };
}

function updateDraftField(
  current: BoxDraft,
  field: keyof BoxDraft,
  value: string,
  lockedAutoFitFields: ReadonlySet<BoxAutoFitField>,
): BoxDraft {
  if (field === 'thickness') {
    return boxDraftWithMaterialThickness(current, value, lockedAutoFitFields);
  }
  if (field === 'style' && value === 'slide-lid' && Number(current.clearance) === 0) {
    return { ...current, style: value, clearance: SLIDE_LID_MIN_CLEARANCE_DRAFT };
  }
  return { ...current, [field]: value };
}

function isAutoFitField(field: keyof BoxDraft): field is BoxAutoFitField {
  return field === 'fingerWidth' || field === 'partSpacing';
}
