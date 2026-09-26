// Dialog controls for the Colour layers preset (ADR-430): palette size,
// cut-out vs stacked output, background, speck size, and a swatch preview of
// the traced colours with the power each colour's operation will start at.

import { useId } from 'react';
import type { TraceOptions } from '../../core/trace';
import {
  MAX_COLOUR_LAYERS,
  MIN_COLOUR_LAYERS,
  type ColourLayerOutput,
} from '../../core/trace/colour-layer-options';
import { colourLayerSettings } from '../../core/trace/colour-layer-power';
import { hexOkLightness } from '../../core/trace/colour-oklab';
import { useStore } from '../state/store';
import { mergeColourLayerSettings } from './colour-layer-settings';
import { TraceCheckboxRow } from './TraceCheckboxRow';
import type { LightBurnTraceSettingOverrides } from './trace-options';

type Props = {
  readonly preset: TraceOptions;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
  /** Colours of the current preview trace, in output order. */
  readonly previewColours?: ReadonlyArray<string> | undefined;
};

const COUNT_CHOICES = Array.from(
  { length: MAX_COLOUR_LAYERS - MIN_COLOUR_LAYERS + 1 },
  (_, i) => MIN_COLOUR_LAYERS + i,
);

export function ColourLayerTraceSettingsControls(props: Props): JSX.Element {
  const set = (patch: LightBurnTraceSettingOverrides): void =>
    props.onChange({ ...props.overrides, ...patch });
  const options = mergeColourLayerSettings(props.preset, props.overrides);
  const layers = options.colourLayers ?? {};
  const output: ColourLayerOutput = layers.output ?? 'cut-out';
  // CNC operation power is not a tone: no power percentages there.
  const laser = useStore((s) => s.project.machine?.kind !== 'cnc');
  return (
    <fieldset className="lf-trace-settings">
      <legend>Colour layers</legend>
      <div className="lf-trace-settings-group">
        <SelectRow
          label="Colours"
          hint="How many flat colours to split the image into, counting the paper. Auto picks the colours the artwork really uses."
          value={layers.colours === undefined ? 'auto' : String(layers.colours)}
          onChange={(value) =>
            set({ colourCount: value === 'auto' ? 'auto' : Number.parseInt(value, 10) })
          }
          choices={[
            { value: 'auto', label: 'Auto' },
            ...COUNT_CHOICES.map((n) => ({ value: String(n), label: String(n) })),
          ]}
        />
        <SelectRow
          label="Layers"
          hint={
            output === 'stacked'
              ? 'Each colour also fills under the darker colours above it, so darker areas are burned by several layers.'
              : 'Each colour burns only its own area. Neighbouring colours share one edge with no gap or overlap.'
          }
          value={output}
          onChange={(value) => set({ colourLayerOutput: value as ColourLayerOutput })}
          choices={[
            { value: 'cut-out', label: 'Cut-out' },
            { value: 'stacked', label: 'Stacked' },
          ]}
        />
        <TraceCheckboxRow
          label="Trace background colour"
          checked={layers.keepBackground === true}
          onChange={(keepBackground) => set({ keepBackground })}
        />
        <SpeckRow
          value={options.despeckleMinPixels ?? 0}
          onChange={(despeckleMinPixels) => set({ despeckleMinPixels })}
        />
      </div>
      <ColourSwatches
        colours={props.previewColours}
        output={output}
        paperTraced={layers.keepBackground === true}
        laser={laser}
      />
      <div className="lf-trace-reset-row">
        <button
          type="button"
          onClick={() => props.onChange({})}
          disabled={Object.keys(props.overrides).length === 0}
          className="lf-btn"
          title="Reset all trace controls to the selected tracing preset."
        >
          Reset trace settings
        </button>
      </div>
    </fieldset>
  );
}

function SelectRow(props: {
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly choices: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  const hintId = useId();
  return (
    <div className="lf-trace-number">
      <label htmlFor={id}>
        <span>{props.label}</span>
        <select
          id={id}
          className="lf-select"
          value={props.value}
          aria-label={`Trace ${props.label.toLowerCase()}`}
          aria-describedby={hintId}
          title={props.hint}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {props.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <p id={hintId}>{props.hint}</p>
    </div>
  );
}

function SpeckRow(props: {
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  const id = useId();
  const hintId = useId();
  const hint = 'Colour areas smaller than this join the colour around them.';
  return (
    <div className="lf-trace-number">
      <label htmlFor={id}>
        <span>Remove specks</span>
        <span className="lf-trace-number-input">
          <input
            id={id}
            className="lf-input"
            type="number"
            min={0}
            max={10000}
            step={1}
            value={props.value}
            aria-label="Trace Remove specks"
            aria-describedby={hintId}
            title={hint}
            onChange={(event) => {
              const next = Number(event.target.value);
              props.onChange(Number.isFinite(next) ? Math.max(0, Math.min(10000, next)) : 0);
            }}
          />
          <span>px²</span>
        </span>
      </label>
      <p id={hintId}>{hint}</p>
    </div>
  );
}

// Swatches in stacking order (lightest first). On a laser each shows the
// share of the operation's power its colour starts at, or "off" for paper
// (colour-layer-power.ts); CNC operations keep their own settings.
function ColourSwatches(props: {
  readonly colours: ReadonlyArray<string> | undefined;
  readonly output: ColourLayerOutput;
  readonly paperTraced: boolean;
  readonly laser: boolean;
}): JSX.Element {
  const colours = props.colours ?? [];
  const settings = colourLayerSettings(colours, 100, {
    output: props.output,
    paperTraced: props.paperTraced,
  });
  const label = (colour: string): string => {
    const setting = settings.get(colour.toLowerCase());
    return setting === undefined || setting.output ? `${setting?.power ?? 100}%` : 'off';
  };
  const ordered = [...colours].sort((a, b) => hexOkLightness(b) - hexOkLightness(a));
  return (
    <section aria-label="Traced colours" style={swatchSectionStyle}>
      {ordered.length === 0 ? (
        <p style={swatchNoteStyle}>The traced colours appear here when the preview is ready.</p>
      ) : (
        <>
          <ul style={swatchListStyle}>
            {ordered.map((colour) => (
              <li key={colour} style={swatchItemStyle} title={swatchTitle(colour, label, props)}>
                <span aria-hidden="true" style={{ ...swatchChipStyle, background: colour }} />
                {props.laser ? <span>{label(colour)}</span> : null}
              </li>
            ))}
          </ul>
          <p style={swatchNoteStyle}>{swatchNote(ordered.length, props.laser)}</p>
        </>
      )}
    </section>
  );
}

function swatchTitle(
  colour: string,
  label: (colour: string) => string,
  props: { readonly laser: boolean },
): string {
  if (!props.laser) return colour;
  const value = label(colour);
  return value === 'off'
    ? `${colour}: paper, created with output off`
    : `${colour}: ${value} of the operation power`;
}

function swatchNote(count: number, laser: boolean): string {
  const layers = `${count} layer${count === 1 ? '' : 's'}, one operation each.`;
  return laser
    ? `${layers} Darker colours start at more power; the percentages are of each new operation's power. Paper (near-white, or the traced background) starts with output off.`
    : layers;
}

const swatchSectionStyle: React.CSSProperties = { marginTop: 14 };
const swatchListStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  listStyle: 'none',
  margin: 0,
  padding: 0,
};
const swatchItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
const swatchChipStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 18,
  height: 18,
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
};
const swatchNoteStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: 11,
  lineHeight: 1.4,
  color: 'var(--lf-text-muted)',
};
