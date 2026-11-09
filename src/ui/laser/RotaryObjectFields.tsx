// Object size fields for Rotary Setup (ADR-373): diameter and circumference
// are one linked measurement, like LightBurn's pair, plus a strip-measure
// helper for parts that calipers cannot measure where the artwork goes. With a
// taper on (ADR-694) the diameter follows the taper's wider end, and the strip
// measures either end instead.

import { useState } from 'react';
import { activeRotaryTaper } from '../../core/devices/rotary';
import { Button } from '../kit';
import {
  displayObjectCircumferenceMm,
  displayRotaryMm,
  editObjectCircumference,
  editRotaryFields,
  type RotaryEdit,
} from './rotary-setup-edit';
import { editRotaryTaper } from './rotary-taper-edit';
import { RotaryMeasureHelper, type RotaryMeasureTarget } from './RotaryMeasureHelper';
import { RotaryNumberField } from './RotarySetupRows';

export type RotaryEditUpdate = (update: (edit: RotaryEdit) => RotaryEdit) => void;

const TAPER_HELD_TITLE = 'Set from the taper’s wider end while Tapered part is on.';

export function RotaryObjectFields(props: {
  readonly edit: RotaryEdit;
  readonly onEdit: RotaryEditUpdate;
}): JSX.Element {
  const [measuring, setMeasuring] = useState(false);
  const { setup } = props.edit;
  const tapered = activeRotaryTaper(setup) !== null;
  const setDiameter = (objectDiameterMm: number): void =>
    props.onEdit((edit) => editRotaryFields(edit, { objectDiameterMm }));
  const use = (apply: (diameterMm: number) => void) => (diameterMm: number) => {
    apply(diameterMm);
    setMeasuring(false);
  };
  const targets: ReadonlyArray<RotaryMeasureTarget> = tapered
    ? [
        {
          label: 'Use for the top',
          onUse: use((topDiameterMm) =>
            props.onEdit((edit) => editRotaryTaper(edit, { topDiameterMm })),
          ),
        },
        {
          label: 'Use for the bottom',
          onUse: use((bottomDiameterMm) =>
            props.onEdit((edit) => editRotaryTaper(edit, { bottomDiameterMm })),
          ),
        },
      ]
    : [{ label: 'Use this diameter', onUse: use(setDiameter) }];
  return (
    <>
      <RotaryNumberField
        label="Object diameter"
        ariaLabel="Rotary object diameter"
        title={
          tapered
            ? TAPER_HELD_TITLE
            : 'Diameter of the part where the artwork goes. Editing it updates the circumference.'
        }
        value={displayRotaryMm(setup.objectDiameterMm)}
        unit="mm"
        disabled={tapered}
        onCommit={setDiameter}
      />
      <RotaryNumberField
        label="Circumference"
        ariaLabel="Rotary object circumference"
        title={
          tapered
            ? TAPER_HELD_TITLE
            : 'Distance once around the part. Editing it updates the diameter.'
        }
        value={displayObjectCircumferenceMm(setup)}
        unit="mm"
        disabled={tapered}
        onCommit={(circumferenceMm) =>
          props.onEdit((edit) => editObjectCircumference(edit, circumferenceMm))
        }
      />
      <div>
        <Button variant="ghost" aria-expanded={measuring} onClick={() => setMeasuring(!measuring)}>
          Measure with a strip…
        </Button>
      </div>
      {measuring ? (
        <RotaryMeasureHelper diameterMm={setup.objectDiameterMm} targets={targets} />
      ) : null}
    </>
  );
}
