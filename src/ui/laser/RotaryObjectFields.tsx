// Object size fields for Rotary Setup (ADR-373): diameter and circumference
// are one linked measurement, like LightBurn's pair, plus a strip-measure
// helper for parts that calipers cannot measure where the artwork goes.

import { useState } from 'react';
import { Button } from '../kit';
import {
  displayObjectCircumferenceMm,
  displayRotaryMm,
  editObjectCircumference,
  editRotaryFields,
  type RotaryEdit,
} from './rotary-setup-edit';
import { RotaryMeasureHelper } from './RotaryMeasureHelper';
import { RotaryNumberField } from './RotarySetupRows';

export type RotaryEditUpdate = (update: (edit: RotaryEdit) => RotaryEdit) => void;

export function RotaryObjectFields(props: {
  readonly edit: RotaryEdit;
  readonly onEdit: RotaryEditUpdate;
}): JSX.Element {
  const [measuring, setMeasuring] = useState(false);
  const { setup } = props.edit;
  const setDiameter = (objectDiameterMm: number): void =>
    props.onEdit((edit) => editRotaryFields(edit, { objectDiameterMm }));
  return (
    <>
      <RotaryNumberField
        label="Object diameter"
        ariaLabel="Rotary object diameter"
        title="Diameter of the part where the artwork goes. Editing it updates the circumference."
        value={displayRotaryMm(setup.objectDiameterMm)}
        unit="mm"
        disabled={false}
        onCommit={setDiameter}
      />
      <RotaryNumberField
        label="Circumference"
        ariaLabel="Rotary object circumference"
        title="Distance once around the part. Editing it updates the diameter."
        value={displayObjectCircumferenceMm(setup)}
        unit="mm"
        disabled={false}
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
        <RotaryMeasureHelper
          diameterMm={setup.objectDiameterMm}
          onUse={(diameterMm) => {
            setDiameter(diameterMm);
            setMeasuring(false);
          }}
        />
      ) : null}
    </>
  );
}
