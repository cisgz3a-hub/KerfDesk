// BoxFitTestFields — the Box Fit Test form grid (split from the dialog for
// the component-size cap): joint dimensions and the clearance ladder. The
// relief tool field only exists in CNC mode (gate-and-hide, ADR-101).

import type { ChangeEvent, CSSProperties } from 'react';
import { CalibrationNumberField } from '../calibration/CalibrationNumberField';
import type { BoxMachineContext } from './box-draft';
import type { FitTestDraft } from './fit-test-draft';

export type FitTestFieldSetter = (
  field: keyof FitTestDraft,
) => (event: ChangeEvent<HTMLInputElement>) => void;

export function BoxFitTestFields(props: {
  readonly draft: FitTestDraft;
  readonly machine: BoxMachineContext;
  readonly setField: FitTestFieldSetter;
}): JSX.Element {
  const { draft, setField } = props;
  return (
    <div style={gridStyle}>
      <CalibrationNumberField
        label="Material thickness (mm)"
        value={draft.thickness}
        min={0.1}
        max={undefined}
        step="any"
        onChange={setField('thickness')}
      />
      <CalibrationNumberField
        label="Finger width"
        value={draft.fingerWidth}
        min={0.5}
        max={undefined}
        step="any"
        onChange={setField('fingerWidth')}
      />
      <CalibrationNumberField
        label="Ladder start"
        value={draft.start}
        min={0}
        max={undefined}
        step="any"
        onChange={setField('start')}
      />
      <CalibrationNumberField
        label="Ladder step"
        value={draft.step}
        min={0.01}
        max={undefined}
        step="any"
        onChange={setField('step')}
      />
      <CalibrationNumberField
        label="Rungs"
        value={draft.rungs}
        min={2}
        max={12}
        step={1}
        onChange={setField('rungs')}
      />
      {props.machine.kind === 'cnc' ? (
        <CalibrationNumberField
          label="Relief tool diameter"
          value={draft.toolDiameter}
          min={0.1}
          max={undefined}
          step="any"
          onChange={setField('toolDiameter')}
        />
      ) : null}
    </div>
  );
}

const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 };
