import { useState } from 'react';
import {
  SURFACING_DEFAULT_STEPOVER_PCT,
  SURFACING_DEFAULT_TOTAL_DEPTH_MM,
  SURFACING_MAX_STEPOVER_PCT,
} from '../../core/cnc/surfacing';
import type { CncMachineConfig, Project } from '../../core/scene';
import { NumberField as ClearableNumberField } from '../common/NumberField';
import { useSourceTrackedState } from '../common/use-source-tracked-state';
import { useStore } from '../state/store';
import { surfacingSeed } from './surfacing-seed';
export function useSurfacingValues(
  machine: CncMachineConfig,
  project: Project,
  projectDocumentEpoch: number,
) {
  const liveCaps = useStore((s) => s.cncLiveCaps);
  // The calculator may lower a surfacing starter value but never raise it past
  // the conservative surfacing defaults (ADR-457 Amd 1).
  const { tool, starter, maxFeed, seed } = surfacingSeed(machine, project, liveCaps);
  const recipeKey = JSON.stringify([
    projectDocumentEpoch,
    tool,
    machine.stock.materialKey,
    starter,
    maxFeed,
    machine.params.spindleMaxRpm,
  ]);
  const [feedMmPerMin, setFeed] = useSourceTrackedState(seed.feedMmPerMin, recipeKey);
  const [plungeMmPerMin, setPlunge] = useSourceTrackedState(seed.plungeMmPerMin, recipeKey);
  const [spindleRpm, setRpm] = useSourceTrackedState(
    starter?.spindleRpm ?? machine.params.spindleMaxRpm,
    recipeKey,
  );
  const [depthPerPassMm, setStepdown] = useSourceTrackedState(seed.depthPerPassMm, recipeKey);
  // The facing area prefills from the stock footprint and must FOLLOW it: a
  // plain useState seed froze at mount, so changing stock size (or opening
  // another project) left this panel saving a program for the old area.
  const stockKey = `${projectDocumentEpoch}:${machine.stock.widthMm}x${machine.stock.heightMm}`;
  const [widthMm, setWidthMm] = useSourceTrackedState(machine.stock.widthMm, stockKey);
  const [heightMm, setHeightMm] = useSourceTrackedState(machine.stock.heightMm, stockKey);
  const [stepoverPct, setStepoverPct] = useState(SURFACING_DEFAULT_STEPOVER_PCT);
  const [totalDepthMm, setTotalDepthMm] = useState(SURFACING_DEFAULT_TOTAL_DEPTH_MM);

  return {
    tool,
    starter,
    maxFeed,
    inputs: {
      widthMm,
      heightMm,
      stepoverPct,
      totalDepthMm,
      feedMmPerMin,
      plungeMmPerMin,
      spindleRpm,
      depthPerPassMm,
    },
    setWidthMm,
    setHeightMm,
    setStepoverPct,
    setTotalDepthMm,
    setFeed,
    setPlunge,
    setRpm,
    setStepdown,
  };
}

type Values = ReturnType<typeof useSurfacingValues>;
export function SurfacingFields({
  values,
  machine,
}: {
  readonly values: Values;
  readonly machine: CncMachineConfig;
}): JSX.Element {
  const { tool, starter, maxFeed, inputs } = values;
  const limited =
    inputs.feedMmPerMin > maxFeed ||
    inputs.plungeMmPerMin > maxFeed ||
    inputs.spindleRpm > machine.params.spindleMaxRpm;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {surfacingFields(values).map((field) => (
          <Num key={field.label} {...field} />
        ))}
      </div>
      <p>
        Active cutter: {tool.name}.{' '}
        {starter === null
          ? 'Generic starting values; verify them for this cutter and material.'
          : 'Starting values use the stock material and active cutter; verify them with a test cut.'}
      </p>
      {limited ? (
        <p role="note">
          Output uses {Math.min(inputs.feedMmPerMin, maxFeed)} mm/min feed,{' '}
          {Math.min(inputs.plungeMmPerMin, maxFeed)} mm/min plunge and{' '}
          {Math.min(inputs.spindleRpm, machine.params.spindleMaxRpm)} RPM after machine limits.
        </p>
      ) : null}
    </>
  );
}
function surfacingFields(v: Values): ReadonlyArray<NumProps> {
  return [
    {
      label: 'Width',
      value: v.inputs.widthMm,
      onCommit: v.setWidthMm,
      title: 'Area width to face (X).',
    },
    {
      label: 'Height',
      value: v.inputs.heightMm,
      onCommit: v.setHeightMm,
      title: 'Area height to face (Y).',
    },
    {
      label: 'Stepover %',
      value: v.inputs.stepoverPct,
      onCommit: v.setStepoverPct,
      title: `Row spacing as a percentage of the active bit's diameter, at most ${String(SURFACING_MAX_STEPOVER_PCT)}%. Wider rows leave uncut strips.`,
      range: { min: 1, max: SURFACING_MAX_STEPOVER_PCT },
    },
    {
      label: 'Total depth',
      value: v.inputs.totalDepthMm,
      onCommit: v.setTotalDepthMm,
      title: 'Total material to remove. The last depth pass stops at this value.',
    },
    {
      label: 'Feed',
      value: v.inputs.feedMmPerMin,
      onCommit: v.setFeed,
      title: 'Cutting feed in mm/min. Output is limited by the CNC maximum feed.',
    },
    {
      label: 'Plunge',
      value: v.inputs.plungeMmPerMin,
      onCommit: v.setPlunge,
      title: 'Plunge feed in mm/min. Output is limited by the CNC maximum feed.',
    },
    {
      label: 'Spindle RPM',
      value: v.inputs.spindleRpm,
      onCommit: v.setRpm,
      title: 'Requested spindle speed. Output is limited by the machine spindle maximum.',
    },
    {
      label: 'Depth per pass',
      value: v.inputs.depthPerPassMm,
      onCommit: v.setStepdown,
      title: 'Maximum material removed per depth pass in mm.',
    },
  ];
}
type NumProps = {
  readonly label: string;
  readonly value: number;
  readonly title: string;
  readonly onCommit: (value: number) => void;
  /** Clamp to this range; without one the field only has to be positive. */
  readonly range?: { readonly min: number; readonly max: number };
};
function Num(props: NumProps): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
      {props.label}
      <ClearableNumberField
        ariaLabel={`Surfacing ${props.label.toLowerCase()}`}
        title={props.title}
        value={props.value}
        {...(props.range === undefined
          ? { positiveOnly: true as const }
          : { min: props.range.min, max: props.range.max })}
        step={0.1}
        onCommit={props.onCommit}
        style={{ width: 76 }}
      />
    </label>
  );
}
