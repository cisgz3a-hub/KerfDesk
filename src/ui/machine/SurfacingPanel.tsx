// SurfacingPanel — spoilboard facing wizard (ADR-103 G8, F-CNC25). Collects
// the area + cut numbers, generates the serpentine program in pure core, and
// saves it as a standalone .nc file. Defaults prefill from the machine's
// stock footprint and active bit.

import { useState } from 'react';
import { SURFACING_DEFAULT_STEPOVER_PCT, SURFACING_DEFAULT_TOTAL_DEPTH_MM } from '../../core/cnc';
import type { CncMachineConfig } from '../../core/scene';
import { usePlatform } from '../app/platform-context';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { useSourceTrackedState } from '../common/use-source-tracked-state';
import { RailSection } from '../kit';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { useSurfacingSave } from './use-surfacing-save';

export function SurfacingPanel(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);
  const project = useStore((s) => s.project);
  const projectDocumentEpoch = useStore((s) => s.projectDocumentEpoch);
  const controllerSettings = useLaserStore((s) => s.controllerSettings);
  const settingsCapability = useLaserStore((s) => s.capabilities.settings);
  const { machine } = props;
  // The facing area prefills from the stock footprint and must FOLLOW it: a
  // plain useState seed froze at mount, so changing stock size (or opening
  // another project) left this panel saving a program for the old area.
  const stockKey = `${projectDocumentEpoch}:${machine.stock.widthMm}x${machine.stock.heightMm}`;
  const [widthMm, setWidthMm] = useSourceTrackedState(machine.stock.widthMm, stockKey);
  const [heightMm, setHeightMm] = useSourceTrackedState(machine.stock.heightMm, stockKey);
  const [stepoverPct, setStepoverPct] = useState(SURFACING_DEFAULT_STEPOVER_PCT);
  const [totalDepthMm, setTotalDepthMm] = useState(SURFACING_DEFAULT_TOTAL_DEPTH_MM);

  const { save, cancel, phase } = useSurfacingSave(
    {
      platform,
      pushToast,
      project,
      machine,
      controllerSettings,
      settingsCapability,
      inputs: { widthMm, heightMm, stepoverPct, totalDepthMm },
    },
    projectDocumentEpoch,
  );

  return (
    <RailSection
      label="Surface spoilboard"
      hint="Generate a serpentine facing program to flatten the spoilboard or stock top."
    >
      <div style={rowStyle}>
        <Num label="Width" value={widthMm} onCommit={setWidthMm} title="Area width to face (X)." />
        <Num
          label="Height"
          value={heightMm}
          onCommit={setHeightMm}
          title="Area height to face (Y)."
        />
      </div>
      <div style={rowStyle}>
        <Num
          label="Stepover %"
          value={stepoverPct}
          onCommit={setStepoverPct}
          title="Row spacing as a percentage of the active bit's diameter."
        />
        <Num
          label="Total depth"
          value={totalDepthMm}
          onCommit={setTotalDepthMm}
          title="Total material to remove, cut in 0.5 mm passes."
        />
      </div>
      <button
        type="button"
        onClick={save}
        title="Generate the facing G-code with the active bit and save it as a standalone .nc file."
      >
        Save surfacing G-code…
      </button>
      {phase !== null && (
        <div role="status">
          {phase === 'preparing'
            ? 'Checking surfacing program… '
            : phase === 'writing'
              ? 'Writing surfacing program… '
              : 'Finishing surfacing save… '}
          {phase !== 'finalizing' && (
            <button type="button" onClick={cancel}>
              Cancel surfacing save
            </button>
          )}
        </div>
      )}
    </RailSection>
  );
}

function Num(props: {
  readonly label: string;
  readonly value: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      {props.label}
      <ClearableNumberField
        ariaLabel={`Surfacing ${props.label.toLowerCase()}`}
        title={props.title}
        value={props.value}
        positiveOnly
        step={0.1}
        onCommit={props.onCommit}
        style={inputStyle}
      />
    </label>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, margin: '2px 0' };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  flex: 1,
};
const inputStyle: React.CSSProperties = { width: 76 };
