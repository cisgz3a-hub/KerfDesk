import { useId, useRef } from 'react';
import { DITHER_ALGORITHMS, type DitherAlgorithm } from '../../core/scene';
import {
  DITHER_THUMBNAIL_COLUMNS,
  DITHER_THUMBNAIL_ROWS,
  ditherThumbnail,
  type RampStop,
} from './dither-thumbnails';
import './dither-swatch-picker.css';

const DITHER_COPY: Readonly<
  Record<DitherAlgorithm, { readonly label: string; readonly description: string }>
> = {
  threshold: {
    label: 'Threshold',
    description: 'Each pixel burns or not, with no shading. Best for logos and line art.',
  },
  'floyd-steinberg': {
    label: 'Floyd-Steinberg',
    description: 'Fine scattered dots. The classic choice for photos.',
  },
  jarvis: { label: 'Jarvis', description: 'Spreads dots widely for smooth, soft photo tones.' },
  stucki: { label: 'Stucki', description: 'Like Jarvis, a little sharper.' },
  atkinson: {
    label: 'Atkinson',
    description: 'Higher contrast. The darkest and lightest tones turn solid.',
  },
  burkes: { label: 'Burkes', description: 'Even dots, between Floyd-Steinberg and Stucki.' },
  sierra3: { label: 'Sierra 3', description: 'Wide, smooth spreading, close to Jarvis.' },
  sierra2: { label: 'Sierra 2', description: 'A lighter Sierra 3 with slightly finer detail.' },
  'sierra-lite': { label: 'Sierra Lite', description: 'A small kernel close to Floyd-Steinberg.' },
  ordered: { label: 'Ordered', description: 'A regular grid of dots, the same in every area.' },
  grayscale: {
    label: 'Grayscale',
    description: 'No dots: power follows brightness between Min power and Power.',
  },
};

const MIXED_HINT = 'Choose one dither for all selected artwork.';
const THUMBNAIL_SCALE = 2;

/**
 * The Dither choice as a radio group of swatches, each the same ramp burned
 * with that mode. `value` is null when the selected artwork disagrees (Mixed):
 * no swatch is checked until one is chosen.
 */
export function DitherSwatchPicker(props: {
  readonly value: DitherAlgorithm | null;
  readonly ariaLabel: string;
  readonly title: string;
  readonly onChange: (algorithm: DitherAlgorithm) => void;
}): JSX.Element {
  const name = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const tabStop = props.value ?? DITHER_ALGORITHMS[0];
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = keyboardTarget(event.key, event.target);
    if (next === null) return;
    event.preventDefault();
    groupRef.current?.querySelector<HTMLInputElement>(`input[value="${next}"]`)?.focus();
    if (next !== props.value) props.onChange(next);
  };
  return (
    <div className="lf-dither-picker">
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={props.ariaLabel}
        title={props.title}
        className="lf-dither-swatches"
        onKeyDown={onKeyDown}
      >
        {DITHER_ALGORITHMS.map((algorithm) => (
          <DitherSwatch
            key={algorithm}
            algorithm={algorithm}
            name={name}
            checked={props.value === algorithm}
            tabbable={tabStop === algorithm}
            onChange={props.onChange}
          />
        ))}
      </div>
      <p className="lf-dither-picker__caption">
        <strong>{props.value === null ? 'Mixed' : DITHER_COPY[props.value].label}</strong>{' '}
        {props.value === null ? MIXED_HINT : DITHER_COPY[props.value].description}
      </p>
    </div>
  );
}

function DitherSwatch(props: {
  readonly algorithm: DitherAlgorithm;
  readonly name: string;
  readonly checked: boolean;
  readonly tabbable: boolean;
  readonly onChange: (algorithm: DitherAlgorithm) => void;
}): JSX.Element {
  const copy = DITHER_COPY[props.algorithm];
  return (
    <label className="lf-dither-swatch" data-checked={props.checked ? 'true' : undefined}>
      <input
        type="radio"
        name={props.name}
        value={props.algorithm}
        checked={props.checked}
        tabIndex={props.tabbable ? 0 : -1}
        aria-label={copy.label}
        title={`${copy.label}: ${copy.description}`}
        onChange={() => props.onChange(props.algorithm)}
      />
      <DitherThumbnailImage algorithm={props.algorithm} />
    </label>
  );
}

function DitherThumbnailImage(props: { readonly algorithm: DitherAlgorithm }): JSX.Element {
  const thumbnail = ditherThumbnail(props.algorithm);
  return (
    <svg
      className="lf-dither-swatch__thumbnail"
      viewBox={`0 0 ${DITHER_THUMBNAIL_COLUMNS} ${DITHER_THUMBNAIL_ROWS}`}
      width={DITHER_THUMBNAIL_COLUMNS * THUMBNAIL_SCALE}
      height={DITHER_THUMBNAIL_ROWS * THUMBNAIL_SCALE}
      aria-hidden="true"
      focusable="false"
      data-dither-thumbnail={thumbnail.kind}
    >
      {thumbnail.kind === 'dots' ? (
        <path d={thumbnail.path} />
      ) : (
        <SmoothRamp stops={thumbnail.stops} />
      )}
    </svg>
  );
}

function SmoothRamp(props: { readonly stops: ReadonlyArray<RampStop> }): JSX.Element {
  const gradientId = `lf-dither-ramp-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  return (
    <>
      <defs>
        <linearGradient id={gradientId}>
          {props.stops.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              stopColor="currentColor"
              stopOpacity={stop.opacity}
            />
          ))}
        </linearGradient>
      </defs>
      <rect
        width={DITHER_THUMBNAIL_COLUMNS}
        height={DITHER_THUMBNAIL_ROWS}
        fill={`url(#${gradientId})`}
      />
    </>
  );
}

// Arrow keys move and select like a native radio group, wrapping at the ends;
// Home and End jump to the first and last mode.
const KEY_STEPS: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
};

function keyboardTarget(key: string, target: EventTarget): DitherAlgorithm | null {
  const step = KEY_STEPS[key];
  if (step === undefined || !(target instanceof HTMLInputElement)) return null;
  const current = DITHER_ALGORITHMS.findIndex((algorithm) => algorithm === target.value);
  if (current < 0) return null;
  return DITHER_ALGORITHMS[step(current, DITHER_ALGORITHMS.length)] ?? null;
}
