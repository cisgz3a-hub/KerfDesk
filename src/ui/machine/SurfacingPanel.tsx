// SurfacingPanel — spoilboard facing wizard (ADR-102 G8, F-CNC25). Collects
// the area + cut numbers, generates the serpentine program in pure core, and
// saves it as a standalone .nc file. Defaults prefill from the machine's
// stock footprint and active bit.

import { useState } from 'react';
import {
  buildSurfacingProgram,
  SURFACING_DEFAULT_DEPTH_PER_PASS_MM,
  SURFACING_DEFAULT_STEPOVER_PCT,
  SURFACING_DEFAULT_TOTAL_DEPTH_MM,
} from '../../core/cnc';
import { activeCncTool, type CncMachineConfig } from '../../core/scene';
import { usePlatform } from '../app/platform-context';
import { useToastStore } from '../state/toast-store';

const GCODE_EXTENSIONS = ['.gcode', '.nc'];
const DEFAULT_FEED_MM_PER_MIN = 2500;
const DEFAULT_PLUNGE_MM_PER_MIN = 600;

export function SurfacingPanel(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);
  const { machine } = props;
  const [widthMm, setWidthMm] = useState(machine.stock.widthMm);
  const [heightMm, setHeightMm] = useState(machine.stock.heightMm);
  const [stepoverPct, setStepoverPct] = useState(SURFACING_DEFAULT_STEPOVER_PCT);
  const [totalDepthMm, setTotalDepthMm] = useState(SURFACING_DEFAULT_TOTAL_DEPTH_MM);

  const save = (): void =>
    void saveSurfacingProgram(platform, pushToast, machine, {
      widthMm,
      heightMm,
      stepoverPct,
      totalDepthMm,
    });

  return (
    <details style={boxStyle}>
      <summary
        style={summaryStyle}
        title="Generate a serpentine facing program to flatten the spoilboard or stock top."
      >
        Surface spoilboard
      </summary>
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
    </details>
  );
}

type SurfacingInputs = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly stepoverPct: number;
  readonly totalDepthMm: number;
};

async function saveSurfacingProgram(
  platform: ReturnType<typeof usePlatform>,
  pushToast: (message: string, variant?: 'success' | 'error') => void,
  machine: CncMachineConfig,
  inputs: SurfacingInputs,
): Promise<void> {
  const tool = activeCncTool(machine);
  const program = buildSurfacingProgram({
    ...inputs,
    bitDiameterMm: tool.diameterMm,
    depthPerPassMm: SURFACING_DEFAULT_DEPTH_PER_PASS_MM,
    feedMmPerMin: DEFAULT_FEED_MM_PER_MIN,
    plungeMmPerMin: DEFAULT_PLUNGE_MM_PER_MIN,
    spindleRpm: machine.params.spindleMaxRpm,
    spindleSpinupSec: machine.params.spindleSpinupSec,
    safeZMm: machine.params.safeZMm,
  });
  try {
    const target = await platform.pickFileForSave({
      suggestedName: 'surfacing.nc',
      extensions: GCODE_EXTENSIONS,
    });
    if (target === null) return;
    await target.write(`${program.lines.join('\n')}\n`);
    pushToast(
      `Saved surfacing program: ${program.passes} pass(es) × ${program.rowsPerPass} rows with the ${tool.name}. Zero X/Y at the area's front-left corner and Z on the surface before running.`,
      'success',
    );
  } catch (err) {
    pushToast(
      `Could not save the surfacing program: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  }
}

const NUM_MIN = 0.1;
const NUM_MAX = 5000;

function Num(props: {
  readonly label: string;
  readonly value: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      {props.label}
      <input
        type="number"
        aria-label={`Surfacing ${props.label.toLowerCase()}`}
        title={props.title}
        value={props.value}
        min={NUM_MIN}
        max={NUM_MAX}
        step={0.1}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= NUM_MIN && v <= NUM_MAX) props.onCommit(v);
        }}
        style={inputStyle}
      />
    </label>
  );
}

const boxStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '4px 6px',
  marginTop: 4,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, margin: '6px 0' };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  flex: 1,
};
const inputStyle: React.CSSProperties = { width: 76 };
