// One laser operation in the Job Review (ADR-224 v3): power with a meter,
// speed, passes and air as large values, the mode detail line, and an Edit
// that turns those four into fields. Save writes them to the main settings
// through the caller (the same store actions the Artwork panel uses), which
// then rebuilds the exact job; Discard or Escape drops the draft. While a
// card is editing it reports so, and the dialog holds Start until it closes.

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { LayerOperationSettings } from '../../../core/scene';
import { Button, Icon, NumberInput } from '../../kit';
import { pushFeedCeilingToast } from '../../layers/feed-ceiling';
import {
  airToggleLabelStyle,
  cardActionsStyle,
  fieldErrorStyle,
  savedNoteStyle,
  valueGridStyle,
  valueInputStyle,
} from './job-review-card.styles';
import {
  draftFromSettings,
  REVIEW_NUMBER_ERROR,
  saveLaserOperationDraft,
  type DraftNumberField,
  type LaserOperationDraft,
} from './job-review-operation-draft';
import type { JobReviewEffectiveOperation } from './job-review-effective-operations';
import type { ReviewRowPatch } from './job-review-operation-edit';
import {
  AirPill,
  CompiledSummary,
  formatReviewNumber,
  OperationCard,
  OperationCardHeader,
  OperationDetail,
  PowerMeter,
  ValueOutput,
  ValueTile,
  type MaterialChip,
} from './JobReviewCardParts';

const SAVED_NOTE_MS = 4000;

type CoreSettings = Pick<
  LayerOperationSettings,
  'power' | 'minPower' | 'speed' | 'passes' | 'airAssist'
>;

export type LaserOperationCardProps = {
  readonly operationId: string;
  /** Names the operation in field labels, e.g. "Power % for Cut". */
  readonly ariaContext: string;
  readonly name: string;
  readonly parentName?: string;
  readonly color: string;
  readonly modeLabel: string;
  readonly material: MaterialChip | null;
  readonly meta: string;
  readonly settings: CoreSettings;
  readonly detail: string;
  readonly maxFeedMmPerMin: number;
  readonly effectiveOperations: ReadonlyArray<JobReviewEffectiveOperation>;
  readonly onSave: (patch: ReviewRowPatch) => void;
  readonly onEditingChange?: (isEditing: boolean) => void;
};

export function JobReviewLaserOperationCard(props: LaserOperationCardProps): JSX.Element {
  const editor = useCardEditor(props);
  const { draft } = editor;
  return (
    <OperationCard
      ariaLabel={`${props.ariaContext} settings`}
      color={props.color}
      isEditing={draft !== null}
      cardRef={editor.cardRef}
    >
      <OperationCardHeader
        color={props.color}
        name={props.name}
        {...(props.parentName === undefined ? {} : { parentName: props.parentName })}
        chip={{ label: props.modeLabel }}
        material={props.material}
        meta={props.meta}
      >
        <CardActions editor={editor} ariaContext={props.ariaContext} />
      </OperationCardHeader>
      {draft === null ? (
        <LaserValues settings={props.settings} ariaContext={props.ariaContext} />
      ) : (
        <LaserDraftFields
          draft={draft}
          invalid={editor.invalid}
          ariaContext={props.ariaContext}
          maxFeedMmPerMin={props.maxFeedMmPerMin}
          onChange={editor.setDraft}
          onSave={editor.save}
        />
      )}
      <OperationDetail text={props.detail} />
      <CompiledSummary
        operationId={props.operationId}
        effectiveOperations={props.effectiveOperations}
      />
    </OperationCard>
  );
}

function LaserValues(props: {
  readonly settings: CoreSettings;
  readonly ariaContext: string;
}): JSX.Element {
  const { settings } = props;
  return (
    <div style={valueGridStyle}>
      <ValueTile label="Power">
        <ValueOutput
          label={`Power % for ${props.ariaContext}`}
          value={formatReviewNumber(settings.power)}
          unit="%"
        />
        <PowerMeter percent={settings.power} />
      </ValueTile>
      <ValueTile label="Speed">
        <ValueOutput
          label={`Speed mm/min for ${props.ariaContext}`}
          value={formatReviewNumber(settings.speed)}
          unit="mm/min"
        />
      </ValueTile>
      <ValueTile label="Passes">
        <ValueOutput
          label={`Passes for ${props.ariaContext}`}
          value={String(settings.passes)}
          unit={settings.passes === 1 ? 'pass' : 'passes'}
        />
      </ValueTile>
      <ValueTile label="Air assist">
        <AirPill label={`Air assist for ${props.ariaContext}`} isOn={settings.airAssist} />
      </ValueTile>
    </div>
  );
}

function LaserDraftFields(props: {
  readonly draft: LaserOperationDraft;
  readonly invalid: ReadonlyArray<DraftNumberField>;
  readonly ariaContext: string;
  readonly maxFeedMmPerMin: number;
  readonly onChange: (draft: LaserOperationDraft) => void;
  readonly onSave: () => void;
}): JSX.Element {
  const { draft } = props;
  const errorId = `review-edit-error-${props.ariaContext.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`;
  const field = (name: DraftNumberField, label: string, extra: Record<string, unknown>) => (
    <ValueTile label={label}>
      <NumberInput
        aria-label={`${label} for ${props.ariaContext}`}
        value={draft[name]}
        onChange={(event) => props.onChange({ ...draft, [name]: event.target.value })}
        lang="en"
        style={valueInputStyle}
        {...(props.invalid.includes(name)
          ? { 'aria-invalid': true, 'aria-describedby': errorId }
          : {})}
        {...extra}
      />
    </ValueTile>
  );
  return (
    <>
      <div
        style={valueGridStyle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          props.onSave();
        }}
      >
        {field('power', 'Power %', { min: 0, max: 100, step: 'any', 'data-autofocus': '' })}
        {field('speed', 'Speed mm/min', { min: 1, max: props.maxFeedMmPerMin })}
        {field('passes', 'Passes', { min: 1, step: 1 })}
        <ValueTile label="Air assist">
          <label style={airToggleLabelStyle}>
            <input
              type="checkbox"
              aria-label={`Air assist for ${props.ariaContext}`}
              checked={draft.airAssist}
              onChange={(event) => props.onChange({ ...draft, airAssist: event.target.checked })}
            />
            {draft.airAssist ? 'On' : 'Off'}
          </label>
        </ValueTile>
      </div>
      {props.invalid.length === 0 ? null : (
        <span id={errorId} role="alert" style={fieldErrorStyle}>
          {REVIEW_NUMBER_ERROR}
        </span>
      )}
    </>
  );
}

type CardEditor = ReturnType<typeof useCardEditor>;

function CardActions(props: {
  readonly editor: CardEditor;
  readonly ariaContext: string;
}): JSX.Element {
  const { editor } = props;
  if (editor.draft !== null) {
    return (
      <span style={cardActionsStyle}>
        <Button variant="ghost" onClick={editor.discard} title="Discard these changes">
          Discard
        </Button>
        <Button variant="primary" onClick={editor.save} title="Save to your Artwork settings">
          Save
        </Button>
      </span>
    );
  }
  return (
    <span style={cardActionsStyle}>
      <span role="status" style={savedNoteStyle}>
        {editor.showSaved ? (
          <>
            <Icon name="check" size={11} />
            Saved
          </>
        ) : null}
      </span>
      <Button
        data-review-edit=""
        onClick={editor.begin}
        title={`Change power, speed, passes or air for ${props.ariaContext}`}
      >
        Edit
      </Button>
    </span>
  );
}

function useCardEditor(props: LaserOperationCardProps) {
  const [draft, setDraft] = useState<LaserOperationDraft | null>(null);
  // The fields as Edit showed them: Save writes only the ones changed since.
  const shown = useRef<LaserOperationDraft | null>(null);
  const [invalid, setInvalid] = useState<ReadonlyArray<DraftNumberField>>([]);
  const [showSaved, setShowSaved] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const isEditing = draft !== null;
  const discard = (): void => {
    setDraft(null);
    setInvalid([]);
  };
  const begin = (): void => {
    shown.current = draftFromSettings(props.settings);
    setDraft(shown.current);
    setInvalid([]);
    setShowSaved(false);
  };
  const save = (): void => {
    if (draft === null) return;
    const result = saveLaserOperationDraft(
      draft,
      props.settings,
      props.maxFeedMmPerMin,
      shown.current ?? undefined,
    );
    if (!result.ok) {
      setInvalid(result.invalid);
      return;
    }
    if (result.cappedSpeed !== null) pushFeedCeilingToast(props.maxFeedMmPerMin);
    if (Object.keys(result.patch).length > 0) props.onSave(result.patch);
    setDraft(null);
    setInvalid([]);
    setShowSaved(true);
  };
  useEditingReport(isEditing, props.onEditingChange);
  useEscapeDiscards(cardRef, isEditing, discard);
  useEditFocus(cardRef, isEditing);
  useEffect(() => {
    if (!showSaved) return undefined;
    const timer = window.setTimeout(() => setShowSaved(false), SAVED_NOTE_MS);
    return (): void => window.clearTimeout(timer);
  }, [showSaved]);
  return { draft, setDraft, invalid, showSaved, cardRef, begin, discard, save };
}

function useEditingReport(
  isEditing: boolean,
  onEditingChange: ((isEditing: boolean) => void) | undefined,
): void {
  const reportRef = useRef(onEditingChange);
  reportRef.current = onEditingChange;
  useEffect(() => {
    if (!isEditing) return undefined;
    reportRef.current?.(true);
    return (): void => reportRef.current?.(false);
  }, [isEditing]);
}

// The dialog closes on an Escape that reaches its backdrop. While a card is
// editing, Escape belongs to the card: a native listener on the card runs
// before the backdrop's in the bubble phase and keeps the review open.
function useEscapeDiscards(
  cardRef: RefObject<HTMLElement>,
  isEditing: boolean,
  discard: () => void,
): void {
  const discardRef = useRef(discard);
  discardRef.current = discard;
  useEffect(() => {
    const node = cardRef.current;
    if (!isEditing || node === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      discardRef.current();
    };
    node.addEventListener('keydown', onKeyDown);
    return (): void => node.removeEventListener('keydown', onKeyDown);
  }, [cardRef, isEditing]);
}

// Edit puts the caret in Power; leaving edit returns focus to Edit.
function useEditFocus(cardRef: RefObject<HTMLElement>, isEditing: boolean): void {
  const wasEditing = useRef(false);
  useEffect(() => {
    const card = cardRef.current;
    if (isEditing) {
      const power = card?.querySelector<HTMLInputElement>('input[data-autofocus]');
      power?.focus();
      power?.select();
    } else if (wasEditing.current) {
      card?.querySelector<HTMLButtonElement>('button[data-review-edit]')?.focus();
    }
    wasEditing.current = isEditing;
  }, [cardRef, isEditing]);
}
