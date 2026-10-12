// Select Circles (LightBurn Edit menu): pick every circle of one diameter, or
// with a diameter in a range. The count updates as the sizes are typed.

import { useMemo, useState } from 'react';
import type { CircleSizeQuery } from '../../core/geometry/circle-detect';
import { useStore } from '../state';
import { matchingCircleIds } from '../state/selection-query-actions';
import { Button, Dialog, DialogActions } from '../kit';
import { useSelectCirclesDialogStore } from './select-circles-dialog-store';

const EXACT_TOLERANCE_MM = 0.01;

type Mode = 'exact' | 'range';

export function SelectCirclesDialogHost(): JSX.Element | null {
  const open = useSelectCirclesDialogStore((state) => state.open);
  return open ? <SelectCirclesDialog /> : null;
}

function SelectCirclesDialog(): JSX.Element {
  const close = useSelectCirclesDialogStore((state) => state.close);
  const scene = useStore((state) => state.project.scene);
  const selectCircles = useStore((state) => state.selectCircles);
  const [mode, setMode] = useState<Mode>('exact');
  const [size, setSize] = useState('3');
  const [min, setMin] = useState('2');
  const [max, setMax] = useState('5');
  const query = useMemo(() => circleQuery(mode, size, min, max), [mode, size, min, max]);
  const count = useMemo(
    () => (query === null ? 0 : matchingCircleIds(scene, query).length),
    [scene, query],
  );
  return (
    <Dialog
      title="Select Circles"
      size="sm"
      onClose={close}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (query === null || count === 0) return;
        selectCircles(query);
        close();
      }}
    >
      <fieldset className="lf-field">
        <legend>Diameter</legend>
        <label>
          <input
            type="radio"
            name="select-circles-mode"
            checked={mode === 'exact'}
            onChange={() => setMode('exact')}
          />{' '}
          Exact size
        </label>
        <label>
          <input
            type="radio"
            name="select-circles-mode"
            checked={mode === 'range'}
            onChange={() => setMode('range')}
          />{' '}
          Range
        </label>
      </fieldset>
      {mode === 'exact' ? (
        <SizeField label="Diameter" value={size} onChange={setSize} />
      ) : (
        <>
          <SizeField label="Minimum" value={min} onChange={setMin} />
          <SizeField label="Maximum" value={max} onChange={setMax} />
        </>
      )}
      <p className="lf-dialog-body" role="status">
        {query === null
          ? 'Enter a diameter above 0 mm (and a maximum no smaller than the minimum).'
          : `${count} ${count === 1 ? 'circle matches' : 'circles match'}.`}
      </p>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={query === null || count === 0}>
          Select
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function SizeField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="lf-field">
      <span>{props.label}</span>
      <input
        className="lf-input"
        type="number"
        min="0"
        step="0.01"
        aria-label={`${props.label} diameter in millimetres`}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      <span>mm</span>
    </label>
  );
}

export function circleQuery(
  mode: Mode,
  size: string,
  min: string,
  max: string,
): CircleSizeQuery | null {
  if (mode === 'exact') {
    const diameterMm = positive(size);
    return diameterMm === null
      ? null
      : { kind: 'exact', diameterMm, toleranceMm: EXACT_TOLERANCE_MM };
  }
  const minMm = positive(min);
  const maxMm = positive(max);
  return minMm === null || maxMm === null || maxMm < minMm ? null : { kind: 'range', minMm, maxMm };
}

function positive(text: string): number | null {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null;
}
