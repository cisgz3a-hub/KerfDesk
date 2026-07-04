// CncSetupPanel — "Material & Bit" card shown in the left rail when the
// project machine is CNC. The Easel-style job setup: what stock is on the
// bed, which bit is in the spindle, and the machine's Z/spindle parameters.

import { CHIPLOAD_MATERIALS } from '../../core/cnc';
import { activeCncTool, type CncMachineConfig } from '../../core/scene';
import { useStore } from '../state';
import { useDebouncedCommit } from '../layers/use-debounced-commit';
import { ProbeControls } from '../laser/ProbeControls';
import { CncDetectedSettingsRow } from './CncDetectedSettingsRow';
import { CncMachineProfilesRow, CncToolManager } from './CncLibraryPanels';
import { CncMachineCatalogRow } from './CncMachineCatalogRow';
import { CncTilingPanel } from './CncTilingPanel';
import { SurfacingPanel } from './SurfacingPanel';

export function CncSetupPanel(): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  if (machine === undefined || machine.kind !== 'cnc') return null;
  return <CncSetupFields machine={machine} />;
}

function CncSetupFields(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const { machine } = props;
  const updateCncMachine = useStore((s) => s.updateCncMachine);
  const tool = activeCncTool(machine);
  return (
    <section aria-label="Material and bit setup" style={cardStyle}>
      <h3 style={headingStyle}>Material &amp; Bit</h3>
      <CncDetectedSettingsRow machine={machine} />
      <CncMaterialSelectRow machine={machine} />
      <Row label="Bit">
        <select
          value={tool.id}
          onChange={(e) => updateCncMachine({ toolId: e.target.value })}
          aria-label="Active bit"
          title="The bit in the spindle. Profile offsets and pocket clearing use its diameter."
          style={selectStyle}
        >
          {machine.tools.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.diameterMm} mm)
            </option>
          ))}
        </select>
      </Row>
      <CncStockFields machine={machine} />
      <CncMachineParamsFields machine={machine} />
      <details style={probeDetailsStyle}>
        <summary
          style={probeSummaryStyle}
          title="Zero work coordinates with a touch plate (G38.2)."
        >
          Set work zero (probe)
        </summary>
        <ProbeControls />
      </details>
      <CncToolManager machine={machine} />
      <CncMachineCatalogRow />
      <CncMachineProfilesRow />
      <CncTilingPanel machine={machine} />
      <SurfacingPanel machine={machine} />
    </section>
  );
}

// Project-level material (ADR-112): Easel's "set material once for the job".
// Picking one auto-fills safe feeds for every layer (and seeds new ones);
// "Custom" clears the association and leaves feeds for hand-tuning. The
// per-layer Material picker on each card overrides this for that layer.
function CncMaterialSelectRow(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const applyCncStockMaterial = useStore((s) => s.applyCncStockMaterial);
  return (
    <Row label="Material">
      <select
        value={props.machine.stock.materialKey ?? ''}
        onChange={(e) => applyCncStockMaterial(e.target.value === '' ? null : e.target.value)}
        aria-label="Project material"
        title="Pick your stock material to auto-fill safe feeds for every layer. Choose Custom to set feeds by hand; each layer can still override."
        style={selectStyle}
      >
        <option value="">Custom (manual feeds)</option>
        {CHIPLOAD_MATERIALS.map((material) => (
          <option key={material.value} value={material.value}>
            {material.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

// Stock (workpiece) dimensions + placement — split from CncSetupFields to
// keep both components inside the size limits (H.2 added the XY footprint).
function CncStockFields(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const { machine } = props;
  const updateCncMachine = useStore((s) => s.updateCncMachine);
  const origin = machine.stock.originOffset;
  return (
    <>
      <NumberRow
        label="Stock thickness"
        unit="mm"
        value={machine.stock.thicknessMm}
        min={0.1}
        max={200}
        step={0.05}
        title="Workpiece thickness. Cut depths deeper than this (plus 1 mm) are blocked."
        onCommit={(thicknessMm) => updateCncMachine({ stock: { thicknessMm } })}
      />
      <NumberRow
        label="Stock width"
        unit="mm"
        value={machine.stock.widthMm}
        min={1}
        max={1500}
        step={1}
        title="Workpiece width (X). Toolpaths outside the stock footprint raise an advisory."
        onCommit={(widthMm) => updateCncMachine({ stock: { widthMm } })}
      />
      <NumberRow
        label="Stock height"
        unit="mm"
        value={machine.stock.heightMm}
        min={1}
        max={1500}
        step={1}
        title="Workpiece height (Y). Toolpaths outside the stock footprint raise an advisory."
        onCommit={(heightMm) => updateCncMachine({ stock: { heightMm } })}
      />
      <NumberRow
        label="Stock origin X"
        unit="mm"
        value={origin.x}
        min={-1500}
        max={1500}
        step={1}
        title="Machine-coordinate X of the stock's near-left corner."
        onCommit={(x) => updateCncMachine({ stock: { originOffset: { ...origin, x } } })}
      />
      <NumberRow
        label="Stock origin Y"
        unit="mm"
        value={origin.y}
        min={-1500}
        max={1500}
        step={1}
        title="Machine-coordinate Y of the stock's near-left corner."
        onCommit={(y) => updateCncMachine({ stock: { originOffset: { ...origin, y } } })}
      />
    </>
  );
}

// Spindle + motion parameters (safe Z, spindle ceiling/spin-up, park point).
// Split from CncSetupFields to keep both under the function-size cap after the
// detected-settings banner landed (ADR-111).
function CncMachineParamsFields(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const { machine } = props;
  const updateCncMachine = useStore((s) => s.updateCncMachine);
  return (
    <>
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
        step={0.5}
        title="Dwell after starting the spindle before the first plunge."
        onCommit={(spindleSpinupSec) => updateCncMachine({ params: { spindleSpinupSec } })}
      />
      <NumberRow
        label="Park X"
        unit="mm"
        value={machine.params.parkXMm ?? 0}
        min={-1500}
        max={1500}
        step={1}
        title="Where the head parks after the job and during bit changes (H.9)."
        onCommit={(parkXMm) => updateCncMachine({ params: { parkXMm } })}
      />
      <NumberRow
        label="Park Y"
        unit="mm"
        value={machine.params.parkYMm ?? 0}
        min={-1500}
        max={1500}
        step={1}
        title="Where the head parks after the job and during bit changes (H.9)."
        onCommit={(parkYMm) => updateCncMachine({ params: { parkYMm } })}
      />
    </>
  );
}

function Row(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <div style={valueStyle}>{props.children}</div>
    </div>
  );
}

function NumberRow(props: {
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.onCommit,
    parse: (s) => {
      const n = Number.parseFloat(s);
      if (!Number.isFinite(n)) return props.value;
      return Math.max(props.min, Math.min(props.max, n));
    },
  });
  return (
    <Row label={props.label}>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={inputStyle}
        aria-label={props.label}
        title={props.title}
      />
      <span style={unitStyle}>{props.unit}</span>
    </Row>
  );
}

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
const headingStyle: React.CSSProperties = { margin: '0 0 6px 0', fontSize: 13 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};
const labelStyle: React.CSSProperties = { width: 108, fontSize: 12, color: 'var(--lf-text-muted)' };
const valueStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, flex: 1 };
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
const inputStyle: React.CSSProperties = { width: 80, padding: '2px 6px' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
const probeDetailsStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
  marginTop: 4,
};
const probeSummaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
