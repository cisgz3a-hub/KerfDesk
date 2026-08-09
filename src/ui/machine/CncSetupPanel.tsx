// CncSetupPanel — "Material & Bit" card shown in the machine rail when the
// project machine is CNC. Stock dimensions and placement live beside the
// visible workpiece on the canvas; this rail keeps material, bit, spindle,
// motion, probe, and machine-library setup together.

import { isCncCoolantMode, type CncCoolantMode, type CncMachineConfig } from '../../core/scene';
import { useStore } from '../state';
import { RailSection } from '../kit';
import { ProbeControls } from '../laser/ProbeControls';
import { ProbePlateRemovalNotice } from '../laser/ProbePlateRemovalNotice';
import { CncActiveBitSelect } from './CncActiveBitSelect';
import { CncDetectedSettingsRow } from './CncDetectedSettingsRow';
import { CncMachineProfilesRow, CncToolManager } from './CncLibraryPanels';
import { CncMachineCatalogRow } from './CncMachineCatalogRow';
import { CncProjectMaterialPicker } from './CncProjectMaterialPicker';
import { CncTilingPanel } from './CncTilingPanel';
import { NumberPairRow, NumberRow, Row, selectStyle } from './CncSetupRows';
import { SurfacingPanel } from './SurfacingPanel';

export function CncSetupPanel(): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  if (machine === undefined || machine.kind !== 'cnc') return null;
  return <CncSetupFields machine={machine} />;
}

function CncSetupFields(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const { machine } = props;
  return (
    <section aria-label="Material and bit setup" style={cardStyle}>
      <h3 style={headingStyle}>Material &amp; Bit</h3>
      <CncDetectedSettingsRow machine={machine} />
      <CncProjectMaterialPicker activeMaterialKey={machine.stock.materialKey} />
      <Row label="Bit">
        <CncActiveBitSelect machine={machine} style={selectStyle} />
      </Row>
      <CncMachineParamsFields machine={machine} />
      <RailSection
        label="Set work zero (probe)"
        hint="Zero work coordinates with a touch plate (G38.2)."
      >
        <ProbeControls />
      </RailSection>
      {/* Outside the collapsed section: the confirmation gates CNC Start, so it
          must be visible even when the probe section is folded. */}
      <ProbePlateRemovalNotice />
      <CncToolManager machine={machine} />
      <CncMachineCatalogRow />
      <CncMachineProfilesRow />
      <CncTilingPanel machine={machine} />
      <SurfacingPanel machine={machine} />
    </section>
  );
}

// Spindle + motion parameters (spindle ceiling/spin-up/coolant, then safe Z
// and the park point). Split from CncSetupFields to keep both under the
// function-size cap after the detected-settings banner landed (ADR-111).
function CncMachineParamsFields(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const { machine } = props;
  const updateCncMachine = useStore((s) => s.updateCncMachine);
  return (
    <>
      <h4 className="lf-subhead">Spindle</h4>
      <NumberRow
        label="Spindle max"
        unit="RPM"
        value={machine.params.spindleMaxRpm}
        min={1000}
        max={60000}
        step={500}
        title="The machine's top spindle speed (the RPM ceiling for every layer, and the GRBL $30 value). Each layer sets its own running speed below."
        onCommit={(spindleMaxRpm) => updateCncMachine({ params: { spindleMaxRpm } })}
      />
      <NumberRow
        label="Spin-up delay"
        unit="s"
        value={machine.params.spindleSpinupSec}
        min={0}
        max={30}
        step={0.1}
        title="Time-based dwell after M3 and before the first plunge. Set enough time for this spindle to reach cutting speed; GRBL does not prove physical RPM."
        onCommit={(spindleSpinupSec) => updateCncMachine({ params: { spindleSpinupSec } })}
      />
      <CoolantRow machine={machine} />
      <h4 className="lf-subhead">Motion</h4>
      <NumberRow
        label="Safe Z"
        unit="mm"
        value={machine.params.safeZMm}
        min={0.5}
        max={50}
        step={0.5}
        title="Clearance height above the stock top for rapid moves between cuts."
        onCommit={(safeZMm) => updateCncMachine({ params: { safeZMm } })}
      />
      <NumberPairRow
        label="Park position"
        unit="mm"
        prefixes={['X', 'Y']}
        first={{
          label: 'Park X',
          value: machine.params.parkXMm ?? 0,
          min: -1500,
          max: 1500,
          step: 1,
          title: 'Where the head parks after the job and during bit changes (H.9).',
          onCommit: (parkXMm) => updateCncMachine({ params: { parkXMm } }),
        }}
        second={{
          label: 'Park Y',
          value: machine.params.parkYMm ?? 0,
          min: -1500,
          max: 1500,
          step: 1,
          title: 'Where the head parks after the job and during bit changes (H.9).',
          onCommit: (parkYMm) => updateCncMachine({ params: { parkYMm } }),
        }}
      />
    </>
  );
}

function CoolantRow(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const updateCncMachine = useStore((s) => s.updateCncMachine);
  return (
    <Row label="Coolant">
      <select
        value={props.machine.params.coolant ?? 'off'}
        onChange={(e) =>
          updateCncMachine({
            params: { coolant: isCncCoolantMode(e.target.value) ? e.target.value : 'off' },
          })
        }
        aria-label="Coolant"
        title="Machine-wide coolant for the whole job. Mist emits M7, Flood emits M8, both turned off with M9 at job end."
        style={selectStyle}
      >
        {COOLANT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

// Coolant modes with their G-code mapping shown so the operator knows which
// relay fires (matches LightBurn/Easel-style labeling of the M-command).
const COOLANT_OPTIONS: ReadonlyArray<{ readonly value: CncCoolantMode; readonly label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'mist', label: 'Mist (M7)' },
  { value: 'flood', label: 'Flood (M8)' },
];

const cardStyle: React.CSSProperties = {
  background: 'var(--lf-bg-2)',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const headingStyle: React.CSSProperties = { margin: '0 0 4px 0', fontSize: 13 };
