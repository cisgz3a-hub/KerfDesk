import { useId } from 'react';
import type { LayerMode } from '../../core/scene';

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
              title={PROCESS_COPY[mode].description}
            >
              <input
                type="radio"
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
    <svg
      className="lf-laser-process__illustration"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="7" y="7" width="26" height="26" rx="5" />
      {props.mixed ? (
        <path d="M14 15h12M14 20h8M14 25h12" />
      ) : props.mode === 'fill' ? (
        <path d="m12 15 3-3m-3 9 9-9m-9 15 15-15m-12 16 13-13m-7 13 7-7m-1 7 1-1" />
      ) : props.mode === 'image' ? (
        <>
          <circle cx="24" cy="15" r="2" />
          <path d="m10 29 8-10 6 7 3-3 4 6" />
        </>
      ) : (
        <path d="M12 27V13h15M12 13l15 14" />
      )}
    </svg>
  );
}
