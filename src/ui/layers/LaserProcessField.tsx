import { useId } from 'react';
import type { LayerMode } from '../../core/scene';
import { IconFrame } from '../kit/icon-frame';

const LASER_MODES = ['line', 'fill', 'image'] as const;
const MIXED_PROCESS_HINT = 'Choose one process to use for all selected artwork.';

const PROCESS_COPY: Record<
  LayerMode,
  { readonly label: string; readonly short: string; readonly description: string }
> = {
  line: {
    label: 'Line · cut or score outlines',
    short: 'Line',
    description:
      'Follow vector outlines. Use power, speed and passes to cut through or mark a line.',
  },
  fill: {
    label: 'Fill · engrave solid areas',
    short: 'Fill',
    description: 'Engrave inside closed shapes. Spacing controls how densely the area is filled.',
  },
  image: {
    label: 'Image · engrave photos',
    short: 'Image',
    description:
      'Turn image brightness into laser dots or shades with a choice of image treatments.',
  },
};

export function LaserProcessField(props: {
  readonly mode: LayerMode;
  readonly mixed?: boolean;
  readonly ariaLabel: string;
  readonly name?: string;
  readonly autoFocus?: boolean;
  readonly onChange: (mode: LayerMode) => void;
  readonly help?: React.ReactNode;
  readonly compact?: boolean;
}): JSX.Element {
  const descriptionId = useId();
  if (props.compact) return <LaserProcessChoice {...props} />;
  const description = props.mixed ? MIXED_PROCESS_HINT : PROCESS_COPY[props.mode].description;
  return (
    <div className="lf-laser-process">
      <div className="lf-laser-process__heading">
        <span className="lf-laser-section-title">Laser process</span>
        {props.help}
      </div>
      <div className="lf-laser-process__choice">
        <ProcessIllustration mode={props.mode} mixed={props.mixed === true} />
        <select
          className="lf-select"
          name={props.name}
          value={props.mixed ? '' : props.mode}
          aria-label={props.ariaLabel}
          aria-describedby={descriptionId}
          title="Choose how the laser processes the artwork"
          autoFocus={props.autoFocus}
          onChange={(event) => props.onChange(event.target.value as LayerMode)}
        >
          {props.mixed ? (
            <option value="" disabled>
              Mixed
            </option>
          ) : null}
          {LASER_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {PROCESS_COPY[mode].label}
            </option>
          ))}
        </select>
      </div>
      <p id={descriptionId} className="lf-laser-help">
        {description}
      </p>
    </div>
  );
}

// The inspector's process picker: three labelled buttons that never truncate.
// Each button's tooltip carries the description the dialog shows as text.
function LaserProcessChoice(props: {
  readonly mode: LayerMode;
  readonly mixed?: boolean;
  readonly ariaLabel: string;
  readonly onChange: (mode: LayerMode) => void;
}): JSX.Element {
  const name = useId();
  return (
    <div className="lf-laser-process-choice">
      <div role="radiogroup" aria-label={props.ariaLabel} className="lf-process-segments">
        {LASER_MODES.map((mode) => {
          const checked = props.mixed !== true && props.mode === mode;
          return (
            <label
              key={mode}
              className="lf-process-segment"
              data-checked={checked ? 'true' : undefined}
            >
              <input
                type="radio"
                title={PROCESS_COPY[mode].description}
                name={name}
                value={mode}
                checked={checked}
                onChange={() => props.onChange(mode)}
              />
              <ProcessIllustration mode={mode} mixed={false} />
              <span>{PROCESS_COPY[mode].short}</span>
            </label>
          );
        })}
      </div>
      {props.mixed ? <p className="lf-laser-help">{MIXED_PROCESS_HINT}</p> : null}
    </div>
  );
}

function ProcessIllustration(props: {
  readonly mode: LayerMode;
  readonly mixed: boolean;
}): JSX.Element {
  return (
    <IconFrame className="lf-laser-process__illustration" size={40}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      {props.mixed ? (
        <path className="lf-icon-accent" d="M8 9h8M8 12h5M8 15h8" />
      ) : props.mode === 'fill' ? (
        <path className="lf-icon-accent" d="m7 10 3-3m-3 7 7-7m-7 10L17 7m-6 10 6-6m-2 6 2-2" />
      ) : props.mode === 'image' ? (
        <>
          <circle className="lf-icon-accent" cx="15" cy="9" r="1.5" />
          <path d="m6 17 5-6 4 4 2-2 2 4" />
        </>
      ) : (
        <path className="lf-icon-accent" d="M8 17V8h9M8 8l9 9" />
      )}
    </IconFrame>
  );
}
