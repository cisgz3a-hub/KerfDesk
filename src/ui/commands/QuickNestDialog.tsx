import { useState } from 'react';
import { Button, Dialog, DialogActions, NumberInput } from '../kit';
import type { QuickNestOptions } from '../state/nest-actions';
import type { NestGoal, NestingInput, NestingProgress } from '../../core/nesting/layout-nest';
import type { NestRotation } from '../../core/nesting';
import { CNC_NEST_SPACING_MARGIN_MM, type CncNestSpacing } from '../../core/cnc/cnc-nest-spacing';
import { NestDraftPreview } from './NestDraftPreview';

export type QuickNestDialogProps = {
  readonly boardAvailable: boolean;
  readonly onCancel: () => void;
  readonly onApply: (options: QuickNestOptions) => void;
  readonly running?: boolean;
  readonly progress?: NestingProgress | null;
  readonly input?: NestingInput;
  readonly stale?: boolean;
  readonly onStop?: () => void;
  readonly onAcceptBest?: () => void;
  readonly onReset?: () => void;
  readonly onProduction?: () => void;
  /** A CNC project's bit-based minimum spacing (ADR-433 Amendment 4). */
  readonly cncSpacing?: CncNestSpacing | null;
};
type NestForm = {
  readonly bin: QuickNestOptions['bin'];
  readonly padding: string;
  readonly allowRotation: boolean;
  readonly method: QuickNestOptions['method'];
  readonly goal: NestGoal | undefined;
  readonly angles: ReadonlyArray<NestRotation>;
  readonly anglesChanged: boolean;
  readonly keepGrain: boolean;
  readonly optimise: boolean;
};
type SettingsProps = {
  readonly form: NestForm;
  readonly change: (patch: Partial<NestForm>) => void;
};
const LASER_SPACING_MM = 2;
const INITIAL: NestForm = {
  bin: 'workspace',
  padding: String(LASER_SPACING_MM),
  allowRotation: true,
  method: 'outline',
  goal: undefined,
  angles: [0, 90],
  anglesChanged: false,
  keepGrain: false,
  optimise: false,
};

export function QuickNestDialog(props: QuickNestDialogProps): JSX.Element {
  const [form, setForm] = useState(() => initialForm(props.cncSpacing ?? null));
  const change = (patch: Partial<NestForm>): void =>
    setForm((previous) => ({ ...previous, ...patch }));
  const permitted = form.allowRotation
    ? form.angles.filter((angle) => !form.keepGrain || angle % 180 === 0)
    : [0];
  const hasDraft = props.progress !== undefined && props.progress !== null;
  return (
    <Dialog
      title="Quick Nest"
      size="md"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        if (props.running || hasDraft || permitted.length === 0) return;
        props.onApply(nestFormRequest(form));
      }}
    >
      <fieldset
        disabled={props.running || hasDraft}
        style={{ ...fieldsStyle, padding: 0, border: 0, margin: 0 }}
      >
        <NestGoalFields form={form} change={change} />
        <NestBoundaryFields
          form={form}
          change={change}
          boardAvailable={props.boardAvailable}
          cncSpacing={props.cncSpacing ?? null}
        />
        <NestOrientationFields form={form} change={change} />
        <label style={checkStyle}>
          <input
            type="checkbox"
            title="Compare a bounded set of arrangements while retaining the best complete valid layout for review."
            checked={form.optimise}
            onChange={(event) => change({ optimise: event.currentTarget.checked })}
          />
          Try more arrangements and retain the best valid result
        </label>
        <p style={{ margin: 0, fontSize: 12 }}>
          Groups stay rigid. Locked objects remain obstacles. Spacing also reserves half its value
          at the boundary. This search does not prove an optimum.
        </p>
        {permitted.length === 0 && (
          <p role="alert">
            Choose at least one permitted turn that respects the grain restriction.
          </p>
        )}
      </fieldset>
      {props.onProduction !== undefined && (
        <Button disabled={props.running} onClick={props.onProduction}>
          Quantity production across sheets
        </Button>
      )}
      <NestDraftProgress {...props} />
      <NestDialogActions {...props} hasDraft={hasDraft} permitted={permitted.length > 0} />
    </Dialog>
  );
}
// A router's parts start one bit plus a margin apart, never closer than the
// laser default (ADR-433 Amendment 4).
// The lead's reach into the gap, when the profile has one (CNC audit v3 N4-P3-2).
function leadText(spacing: CncNestSpacing): string {
  if (!(spacing.leadReachMm > 0)) return '';
  return ` and its ${Math.round(spacing.leadReachMm * 100) / 100} mm lead`;
}

function initialForm(cncSpacing: CncNestSpacing | null): NestForm {
  if (cncSpacing === null) return INITIAL;
  return { ...INITIAL, padding: String(Math.max(LASER_SPACING_MM, cncSpacing.spacingMm)) };
}
function nestFormRequest(form: NestForm): QuickNestOptions {
  return {
    bin: form.bin,
    padding: nonNegative(form.padding),
    allowRotation: form.allowRotation,
    method: form.method,
    ...(form.goal === undefined ? {} : { goal: form.goal }),
    ...(form.anglesChanged && form.allowRotation ? { rotationAngles: form.angles } : {}),
    ...(form.keepGrain ? { keepGrain: true } : {}),
    ...(form.optimise ? { optimise: true } : {}),
  };
}
function NestGoalFields({ form, change }: SettingsProps): JSX.Element {
  return (
    <>
      <label style={fieldStyle}>
        <span>Layout goal</span>
        <select
          title="Choose compact packing, tidy rectangular placement or a grid of uniform cells."
          value={form.goal ?? 'compact'}
          onChange={(event) => change({ goal: event.currentTarget.value as NestGoal })}
        >
          <option value="tidy">Tidy</option>
          <option value="compact">Compact</option>
          <option value="grid">Grid</option>
        </select>
      </label>
      <p style={{ margin: 0, fontSize: 12 }}>{goalDescription(form.goal ?? 'compact')}</p>
      {(form.goal ?? 'compact') === 'compact' && (
        <NestingMethod value={form.method} onChange={(method) => change({ method })} />
      )}
    </>
  );
}
function goalDescription(goal: NestGoal): string {
  if (goal === 'tidy') return 'Group similar sizes using conservative rectangular packing.';
  if (goal === 'grid') return 'Uniform rows and columns using conservative rectangular bounds.';
  return 'Reduce the layout footprint; closed outlines can interlock where available.';
}
function NestBoundaryFields({
  form,
  change,
  boardAvailable,
  cncSpacing,
}: SettingsProps & {
  readonly boardAvailable: boolean;
  readonly cncSpacing: CncNestSpacing | null;
}): JSX.Element {
  return (
    <>
      <label style={fieldStyle}>
        <span>Nest into</span>
        <select
          title="Choose the boundary that contains the nested selection"
          value={form.bin}
          onChange={(event) =>
            change({ bin: event.currentTarget.value as QuickNestOptions['bin'] })
          }
        >
          <option value="workspace">Workspace</option>
          <option value="board" disabled={!boardAvailable}>
            Placed board
          </option>
        </select>
      </label>
      <label style={fieldStyle}>
        <span>Part spacing (mm)</span>
        <NumberInput
          value={form.padding}
          min={0}
          step={0.1}
          onChange={(event) => change({ padding: event.currentTarget.value })}
        />
      </label>
      {cncSpacing !== null && nonNegative(form.padding) < cncSpacing.spacingMm && (
        <p role="status" style={spacingWarningStyle}>
          Closer than the {cncSpacing.bitDiameterMm} mm bit{leadText(cncSpacing)} plus{' '}
          {CNC_NEST_SPACING_MARGIN_MM} mm: the bit that cuts one part out can cut into the next
          {cncSpacing.leadReachMm > 0 ? ', or plunge on its cut line where no lead fits' : ''}. Use
          at least {cncSpacing.spacingMm} mm.
        </p>
      )}
    </>
  );
}
function NestOrientationFields({ form, change }: SettingsProps): JSX.Element {
  return (
    <>
      <label style={checkStyle}>
        <input
          type="checkbox"
          title="Allow the permitted turns relative to each part's current orientation"
          checked={form.allowRotation}
          onChange={(event) => change({ allowRotation: event.currentTarget.checked })}
        />
        Allow rotation
      </label>
      {form.allowRotation && (
        <div
          role="group"
          aria-label="Permitted rotation angles"
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}
        >
          {([0, 90, 180, 270] as const).map((angle) => (
            <label key={angle} style={checkStyle}>
              <input
                type="checkbox"
                title={`Permit a ${angle}° turn relative to each part's current orientation during nesting.`}
                checked={form.angles.includes(angle)}
                disabled={form.keepGrain && angle % 180 !== 0}
                onChange={(event) =>
                  change({
                    anglesChanged: true,
                    angles: event.currentTarget.checked
                      ? [...form.angles, angle]
                      : form.angles.filter((value) => value !== angle),
                  })
                }
              />
              {angle}°
            </label>
          ))}
        </div>
      )}
      <label style={checkStyle}>
        <input
          type="checkbox"
          title="Restrict permitted turns to 0° and 180° relative to the current grain axis; no material grain is measured."
          checked={form.keepGrain}
          onChange={(event) => change({ keepGrain: event.currentTarget.checked })}
        />
        Keep each part's current grain axis (0° / 180° only)
      </label>
    </>
  );
}
function NestDraftProgress(props: QuickNestDialogProps): JSX.Element | null {
  const progress = props.progress;
  if (progress === undefined || progress === null) return null;
  return (
    <div style={{ ...fieldsStyle, marginTop: 12 }}>
      <div role="status" aria-live="polite">
        {searchStatus(props.running, progress)} · {progress.attempted} / {progress.total}{' '}
        arrangements tried
      </div>
      <progress
        aria-label="Arrangements tried"
        value={progress.attempted}
        max={progress.total}
        style={{ width: '100%' }}
      />
      {progress.best !== null && props.input !== undefined ? (
        <>
          <NestDraftPreview input={props.input} layout={progress.best} />
          <p style={{ margin: 0, fontSize: 13 }}>
            Stock utilisation: {progress.best.stockUtilisationPercent.toFixed(1)}%. Parts / layout
            footprint: {progress.best.layoutUtilisationPercent.toFixed(1)}%. Footprint:{' '}
            {progress.best.footprintAreaMm2.toFixed(1)} mm².
          </p>
          <p style={{ margin: 0, fontSize: 12 }}>
            {progress.best.boundsFallbackUnits} unit(s) use conservative rectangular bounds. Stock
            percentage uses the whole boundary; footprint includes gaps and space before the layout.
          </p>
        </>
      ) : (
        <p>No complete valid arrangement has been found yet.</p>
      )}
      {props.stale && (
        <p role="alert">Artwork changed. Calculate a fresh draft before accepting it.</p>
      )}
    </div>
  );
}
function searchStatus(running: boolean | undefined, progress: NestingProgress): string {
  if (running) return 'Searching';
  return progress.attempted === progress.total ? 'Search complete' : 'Search stopped';
}
function NestDialogActions(
  props: QuickNestDialogProps & { readonly hasDraft: boolean; readonly permitted: boolean },
): JSX.Element {
  return (
    <DialogActions>
      <Button onClick={props.onCancel}>Cancel</Button>
      {props.running && <Button onClick={() => props.onStop?.()}>Stop search</Button>}
      {!props.running && props.hasDraft && (
        <Button onClick={() => props.onReset?.()}>Change settings</Button>
      )}
      {props.hasDraft ? (
        <Button
          variant="primary"
          disabled={props.progress?.best === null || props.stale === true}
          onClick={() => props.onAcceptBest?.()}
        >
          Accept best valid layout
        </Button>
      ) : (
        <Button type="submit" variant="primary" disabled={props.running || !props.permitted}>
          Nest selection
        </Button>
      )}
    </DialogActions>
  );
}
function NestingMethod(props: {
  readonly value: QuickNestOptions['method'];
  readonly onChange: (value: QuickNestOptions['method']) => void;
}): JSX.Element {
  return (
    <div style={fieldStyle}>
      <span>Nesting method</span>
      <div role="group" aria-label="Nesting method" style={methodStyle}>
        <Button
          pressed={props.value === 'outline'}
          title="Use closed vector outlines to compact concave parts and parts with holes."
          onClick={() => props.onChange('outline')}
        >
          Outline
        </Button>
        <Button
          pressed={props.value === 'fast'}
          title="Use fast rectangular bounds for large or mixed raster selections."
          onClick={() => props.onChange('fast')}
        >
          Fast
        </Button>
      </div>
    </div>
  );
}
function nonNegative(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 10 };
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(130px, 1fr) 120px',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const spacingWarningStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-warning-fg)',
};
const methodStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 4,
};
