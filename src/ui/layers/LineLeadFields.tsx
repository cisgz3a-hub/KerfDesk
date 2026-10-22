// Cut Settings → Line detail → Lead-in / Lead-out (ADR-626, LBG-C14): start
// and stop each closed shape in the scrap, so the heavier burn where the beam
// starts and stops stays off the finished edge. KerfDesk works out which side
// is scrap (outside a shape, inside a hole) unless the operation picks a side.

import { useState } from 'react';
import {
  leadAngleDegFor,
  leadLengthMmFor,
  leadSideFor,
  leadStyleFor,
  MAX_LEAD_LENGTH_MM,
  maxLeadAngleDeg,
  MIN_LEAD_ANGLE_DEG,
  MIN_LEAD_LENGTH_MM,
} from '../../core/job/laser-lead-settings';
import type { Layer } from '../../core/scene';
// Deep import: core/scene's barrel is ratcheted and may only shrink.
import type { LaserLeadStyle } from '../../core/scene/layer';
import { Field, NumberInput } from './CutSettingsInputs';

export function LineLeadFields(props: { readonly layer: Layer }): JSX.Element {
  const { layer } = props;
  const [style, setStyle] = useState<LaserLeadStyle>(leadStyleFor(layer));
  return (
    <fieldset
      className="lf-fieldset"
      title="Start and stop each closed shape in the scrap, so the mark where the beam starts and stops stays off the part."
    >
      <legend>Lead-in / Lead-out</legend>
      <p className="lf-laser-help">
        Starts and stops each closed shape in the scrap: outside a shape, inside a hole. A lead that
        does not fit is shortened or left out, and Job Review says so.
      </p>
      <LeadSwitches layer={layer} />
      <Field label="Style">
        <select
          name="leadStyle"
          className="lf-select"
          value={style}
          onChange={(event) => setStyle(event.target.value === 'line' ? 'line' : 'arc')}
          aria-label="Cut settings lead style"
          title="An arc joins the cut smoothly, without slowing down. A line joins it at an angle."
        >
          <option value="arc">Arc</option>
          <option value="line">Line</option>
        </select>
      </Field>
      <LeadSizeFields layer={layer} style={style} />
      <LeadSideField layer={layer} />
    </fieldset>
  );
}

function LeadSwitches(props: { readonly layer: Layer }): JSX.Element {
  const { layer } = props;
  return (
    <>
      <Field label="Lead-in">
        <input
          name="leadInEnabled"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={layer.leadInEnabled === true}
          aria-label="Cut settings enable lead-in"
          title="Start each closed shape with a short lead in the scrap."
        />
      </Field>
      <Field label="Lead-out">
        <input
          name="leadOutEnabled"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={layer.leadOutEnabled === true}
          aria-label="Cut settings enable lead-out"
          title="End each closed shape with a short lead into the scrap."
        />
      </Field>
    </>
  );
}

function LeadSizeFields(props: {
  readonly layer: Layer;
  readonly style: LaserLeadStyle;
}): JSX.Element {
  const { layer, style } = props;
  return (
    <>
      <Field label="Length">
        <NumberInput
          name="leadLengthMm"
          value={leadLengthMmFor(layer)}
          min={MIN_LEAD_LENGTH_MM}
          max={MAX_LEAD_LENGTH_MM}
          label="lead length"
          title="Length of each lead in millimeters."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label={style === 'arc' ? 'Arc angle' : 'Angle'}>
        <NumberInput
          key={style}
          name="leadAngleDeg"
          value={leadAngleDegFor(layer, style)}
          min={MIN_LEAD_ANGLE_DEG}
          max={maxLeadAngleDeg(style)}
          label="lead angle"
          title={
            style === 'arc'
              ? 'How far the arc turns before it meets the cut. 90 is a quarter circle.'
              : 'The angle the line meets the cut at. 90 comes straight in from the side.'
          }
        />
        <span className="lf-field-unit">°</span>
      </Field>
    </>
  );
}

function LeadSideField(props: { readonly layer: Layer }): JSX.Element {
  return (
    <Field label="Side">
      <select
        name="leadSide"
        className="lf-select"
        defaultValue={leadSideFor(props.layer)}
        aria-label="Cut settings lead side"
        title="Automatic puts leads outside shapes and inside holes. Choose a side to put every lead of this operation there."
      >
        <option value="auto">Scrap side (automatic)</option>
        <option value="outside">Always outside</option>
        <option value="inside">Always inside</option>
      </select>
    </Field>
  );
}
