import { useState } from 'react';
import type { CncMachineConfig } from '../../../core/scene';
import type { CncMachiningSetup } from '../../../core/scene/cnc-machining-setup';
import { DEFAULT_CNC_WRAP_STUDY, type CncWrapStudy } from '../../../core/scene/cnc-wrap-study';
import { cncWrapOutputAvailability } from '../../../core/cnc/wrap/cnc-wrap-capabilities';
import { useStore } from '../../state';
import { CncWrapStudyReview } from './CncWrapStudyReview';
export function DeviceSetupCncWrapStudy(props: {
  readonly machine: CncMachineConfig;
  readonly setup: CncMachiningSetup;
  readonly onChange: (setup: CncMachiningSetup) => void;
}): JSX.Element {
  const project = useStore((s) => s.project);
  const [open, setOpen] = useState(false),
    study = props.setup.wrapStudy ?? DEFAULT_CNC_WRAP_STUDY;
  function edit(change: Partial<CncWrapStudy>): void {
    props.onChange({ ...props.setup, wrapStudy: { ...study, ...change } });
  }
  const fields = [
    ['radiusMm', 'Cylinder radius (mm)'],
    ['seamMm', 'Flat-artwork seam coordinate (mm)'],
    ['rotaryDatumDeg', 'A-axis datum (degrees)'],
    ['axialDatumMm', 'Axial offset (mm)'],
    ['radialClearanceMm', 'Radial travel clearance (mm)'],
  ] as const;
  return (
    <details>
      <summary title="Offline wrap parameters">CNC wrapping · reference planning</summary>
      <p>{cncWrapOutputAvailability(study.capabilityId).reason}</p>
      <p>Reference post: grblHAL, A in degrees, G93 inverse-time feed, G54, cylinder-surface Z0.</p>
      {fields.map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            title={label}
            type="number"
            aria-label={label}
            value={study[key]}
            onChange={(e) => edit({ [key]: Number(e.currentTarget.value) })}
          />
        </label>
      ))}
      <label>
        Circumferential flat axis
        <select
          title="Choose which flat coordinate wraps around the cylinder"
          value={study.circumferentialAxis}
          onChange={(e) => edit({ circumferentialAxis: e.currentTarget.value as 'x' | 'y' })}
        >
          <option value="x">X wraps around cylinder; Y is axial</option>
          <option value="y">Y wraps around cylinder; X is axial</option>
        </select>
      </label>
      <label>
        Rotary direction
        <select
          title="Choose the sign of the reference rotary-angle coordinates"
          value={study.direction}
          onChange={(e) => edit({ direction: Number(e.currentTarget.value) as 1 | -1 })}
        >
          <option value={1}>Positive</option>
          <option value={-1}>Negative</option>
        </select>
      </label>
      <p>
        Save retains these study dimensions. Ordinary flat machining stays active. Study artifacts
        include the source and reference-program hashes for controller qualification.
      </p>
      <button title="Review offline wrap study" type="button" onClick={() => setOpen(true)}>
        Review offline wrap study…
      </button>
      {open ? (
        <CncWrapStudyReview
          project={project}
          machine={props.machine}
          setup={props.setup}
          study={study}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </details>
  );
}
