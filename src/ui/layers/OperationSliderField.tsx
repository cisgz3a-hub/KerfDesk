import { useId, useRef, useState } from 'react';
import { nearestSpeedStopIndex } from '../../core/devices/working-speed-range';
import { useStore } from '../state/store';
import { useMixedOperationNumber } from './mixed-operation-input';
import { spinTextProps } from './spin-text-field';
import './operation-slider-field.css';

type OperationSliderFieldProps = {
  readonly label: string;
  readonly unit: string;
  readonly ariaContext: string;
  readonly title: string;
  readonly value: number;
  /** Exact entry's limits; also the slider's unless `stops` is given. */
  readonly min: number;
  readonly max: number;
  /**
   * The values the slider can land on, ascending, spaced as the track should
   * show them (Speed's log scale). Exact entry still spans min to max.
   */
  readonly stops?: ReadonlyArray<number> | undefined;
  /** A second reading of the value beside the label, such as mm/s. */
  readonly describe?: ((value: number) => string) | undefined;
  readonly mixed?: boolean | undefined;
  readonly reconcileKey?: unknown;
  readonly parse: (value: string) => number;
  readonly validate?: ((value: string) => string | null) | undefined;
  readonly inputType?: 'number' | 'text';
  readonly commit: (value: number) => void;
  readonly observe?: (value: string) => void;
};

const scaleFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
// Decade labels closer than this to an end label would overlap it.
const TICK_END_CLEARANCE = 0.12;

function useSliderDraft(props: OperationSliderFieldProps) {
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ epoch: number; key: unknown; awaitingFocus: boolean } | null>(null);
  const ownsGesture = (): boolean =>
    gesture.current === null ||
    (gesture.current.epoch === useStore.getState().projectDocumentEpoch &&
      Object.is(gesture.current.key, props.reconcileKey));
  const draft = useMixedOperationNumber({
    value: props.value,
    mixed: props.mixed,
    reconcileKey: props.reconcileKey,
    parse: props.parse,
    validate: props.validate,
    commit: props.commit,
    commitOnBlur: dragging,
  });
  const change = (text: string, input: HTMLInputElement): void => {
    if (!ownsGesture()) return;
    props.observe?.(text);
    draft.changeText(text, input);
  };
  const onChange: React.ChangeEventHandler<HTMLInputElement> = (event) =>
    change(event.target.value, event.target);
  // With stops the range's value is a stop index, not the setting itself.
  const onRangeChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const stop = props.stops?.[Number(event.target.value)];
    change(stop === undefined ? event.target.value : String(stop), event.target);
  };
  const finishDrag = (): void => {
    if (ownsGesture()) draft.onBlur();
    gesture.current = null;
    setDragging(false);
  };
  const startDrag: React.PointerEventHandler<HTMLInputElement> = (event) => {
    gesture.current = {
      epoch: useStore.getState().projectDocumentEpoch,
      key: props.reconcileKey,
      awaitingFocus: document.activeElement !== event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const focusSlider = (): void => {
    // Native order is pointerdown -> the old number field's blur -> focus.
    // That blur may commit another setting. Adopt its new baseline before
    // this drag starts, then reject subsequent external changes as usual.
    if (
      gesture.current?.awaitingFocus &&
      gesture.current.epoch === useStore.getState().projectDocumentEpoch
    ) {
      gesture.current.key = props.reconcileKey;
      gesture.current.awaitingFocus = false;
    }
  };
  return { ...draft, change, onChange, onRangeChange, startDrag, finishDrag, focusSlider };
}

type SliderTrack = {
  readonly min: number;
  readonly max: number;
  readonly position: number;
  /** 0..1 along the track. */
  readonly fraction: number;
  readonly low: number;
  readonly high: number;
  readonly ticks: ReadonlyArray<{ readonly value: number; readonly fraction: number }>;
};

function sliderTrack(props: OperationSliderFieldProps, value: number): SliderTrack {
  const stops = props.stops;
  if (stops === undefined || stops.length === 0) {
    const position = Math.max(props.min, Math.min(props.max, value));
    const fraction = (position - props.min) / Math.max(1, props.max - props.min);
    return {
      min: props.min,
      max: props.max,
      position,
      fraction,
      low: props.min,
      high: props.max,
      ticks: [],
    };
  }
  const last = stops.length - 1;
  const position = nearestSpeedStopIndex(stops, value);
  const ticks = stops.flatMap((stop, index) => {
    const fraction = last === 0 ? 0 : index / last;
    const decade = 10 ** Math.round(Math.log10(stop)) === stop;
    const clear = fraction > TICK_END_CLEARANCE && fraction < 1 - TICK_END_CLEARANCE;
    return decade && clear ? [{ value: stop, fraction }] : [];
  });
  return {
    min: 0,
    max: last,
    position,
    fraction: last === 0 ? 1 : position / last,
    low: stops[0] ?? props.min,
    high: stops[last] ?? props.max,
    ticks,
  };
}

function SliderScale(props: { readonly track: SliderTrack; readonly mixed: boolean }): JSX.Element {
  const { track, mixed } = props;
  return (
    <div className="lf-operation-slider__scale" aria-hidden="true">
      <span>{scaleFormat.format(track.low)}</span>
      <span>{mixed ? 'Mixed' : null}</span>
      {mixed
        ? null
        : track.ticks.map((tick) => (
            <span
              key={tick.value}
              className="lf-operation-slider__tick"
              style={{ '--tick': tick.fraction } as React.CSSProperties}
            >
              {scaleFormat.format(tick.value)}
            </span>
          ))}
      <span>{scaleFormat.format(track.high)}</span>
    </div>
  );
}

/** A quick adjustment plus exact entry, sharing one document-owned draft. */
export function OperationSliderField(props: OperationSliderFieldProps): JSX.Element {
  const id = useId();
  const draft = useSliderDraft(props);
  const mixed = draft.inputProps['data-mixed'] === 'true';
  const parsed = props.parse(draft.displayValue);
  const value = Math.max(
    props.min,
    Math.min(props.max, Number.isFinite(parsed) ? parsed : props.value),
  );
  const track = sliderTrack(props, value);
  const reading = mixed ? undefined : props.describe?.(value);
  // A box that takes units is text, kept a spin button (spin-text-field).
  const spin =
    props.inputType === 'text'
      ? spinTextProps(
          { current: props.parse, step: 1, min: props.min, max: props.max, change: draft.change },
          draft.displayValue,
        )
      : {};
  return (
    <div className="lf-operation-slider" role="group" aria-labelledby={`${id}-label`}>
      <div className="lf-operation-slider__heading">
        <label id={`${id}-label`} htmlFor={`${id}-number`}>
          {props.label} <span className="lf-operation-slider__unit">{props.unit}</span>
          {/* The space lets a narrow panel wrap the reading onto its own line. */}
          {reading === undefined ? null : (
            <>
              {' '}
              <span className="lf-operation-slider__reading" aria-hidden="true">
                {reading}
              </span>
            </>
          )}
        </label>
        <input
          id={`${id}-number`}
          type={props.inputType ?? 'number'}
          inputMode="decimal"
          aria-invalid={draft.errorMessage !== null}
          min={props.min}
          max={props.max}
          value={draft.displayValue}
          {...draft.inputProps}
          {...spin}
          onChange={draft.onChange}
          onBlur={draft.onBlur}
          aria-label={`${props.label} for ${props.ariaContext}`}
          title={props.title}
        />
      </div>
      <input
        className="lf-operation-slider__range"
        type="range"
        min={track.min}
        max={track.max}
        step={1}
        value={track.position}
        disabled={mixed}
        aria-label={`${props.label} slider for ${props.ariaContext}`}
        aria-valuetext={
          mixed
            ? 'Mixed; enter a number to set all selected artworks'
            : `${value} ${props.unit}${reading === undefined ? '' : ` (${reading})`}`
        }
        title={mixed ? 'Mixed values. Enter a number to set all selected artworks.' : props.title}
        style={{ '--slider-fill': `${track.fraction * 100}%` } as React.CSSProperties}
        onPointerDown={draft.startDrag}
        onFocus={draft.focusSlider}
        onChange={draft.onRangeChange}
        onPointerUp={draft.finishDrag}
        onPointerCancel={draft.finishDrag}
        onLostPointerCapture={draft.finishDrag}
        onBlur={draft.finishDrag}
      />
      <SliderScale track={track} mixed={mixed} />
    </div>
  );
}
