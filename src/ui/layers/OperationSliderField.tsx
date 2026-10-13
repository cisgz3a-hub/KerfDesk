import { useId, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useMixedOperationNumber } from './mixed-operation-input';
import './operation-slider-field.css';

type OperationSliderFieldProps = {
  readonly label: string;
  readonly unit: string;
  readonly ariaContext: string;
  readonly title: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly mixed?: boolean | undefined;
  readonly reconcileKey?: unknown;
  readonly parse: (value: string) => number;
  readonly commit: (value: number) => void;
  readonly observe?: (value: string) => void;
};

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
    commit: props.commit,
    commitOnBlur: dragging,
  });
  const onChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    if (!ownsGesture()) return;
    props.observe?.(event.target.value);
    draft.onChange(event);
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
  return { ...draft, onChange, startDrag, finishDrag, focusSlider };
}

/** A quick adjustment plus exact entry, sharing one document-owned draft. */
export function OperationSliderField(props: OperationSliderFieldProps): JSX.Element {
  const id = useId();
  const draft = useSliderDraft(props);
  const mixed = draft.inputProps['data-mixed'] === 'true';
  const parsed = Number.parseFloat(draft.displayValue);
  const value = Math.max(
    props.min,
    Math.min(props.max, Number.isFinite(parsed) ? parsed : props.value),
  );
  const fill = ((value - props.min) / Math.max(1, props.max - props.min)) * 100;
  return (
    <div className="lf-operation-slider" role="group" aria-labelledby={`${id}-label`}>
      <div className="lf-operation-slider__heading">
        <label id={`${id}-label`} htmlFor={`${id}-number`}>
          {props.label} <span className="lf-operation-slider__unit">{props.unit}</span>
        </label>
        <input
          id={`${id}-number`}
          type="number"
          min={props.min}
          max={props.max}
          value={draft.displayValue}
          {...draft.inputProps}
          onChange={draft.onChange}
          onBlur={draft.onBlur}
          aria-label={`${props.label} for ${props.ariaContext}`}
          title={props.title}
        />
      </div>
      <input
        className="lf-operation-slider__range"
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={value}
        disabled={mixed}
        aria-label={`${props.label} slider for ${props.ariaContext}`}
        aria-valuetext={
          mixed ? 'Mixed; enter a number to set all selected artworks' : `${value} ${props.unit}`
        }
        title={mixed ? 'Mixed values. Enter a number to set all selected artworks.' : props.title}
        style={{ '--slider-fill': `${fill}%` } as React.CSSProperties}
        onPointerDown={draft.startDrag}
        onFocus={draft.focusSlider}
        onChange={draft.onChange}
        onPointerUp={draft.finishDrag}
        onPointerCancel={draft.finishDrag}
        onLostPointerCapture={draft.finishDrag}
        onBlur={draft.finishDrag}
      />
      <div className="lf-operation-slider__scale" aria-hidden="true">
        <span>{props.min.toLocaleString('en-US')}</span>
        <span>{mixed ? 'Mixed' : null}</span>
        <span>{props.max.toLocaleString('en-US')}</span>
      </div>
    </div>
  );
}
