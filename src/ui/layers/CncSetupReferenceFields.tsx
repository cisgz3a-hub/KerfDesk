import type { CncMachineConfig } from '../../core/scene';
import { RailSection } from '../kit';
import { useStore } from '../state';
import { SetupOwnedValueRow } from './SetupOwnedValueRow';

/** Machine and stock values remain references to the shared job setup. */
export function CncSetupReferenceFields(): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  if (machine?.kind !== 'cnc') return null;
  return (
    <RailSection
      label="Stock & machine reference"
      hint="Review stock, machine limits, clearance and output values from Machine Setup."
    >
      <p className="lf-cnc-settings-hint">
        These values come from Machine Setup. Select one to see what it controls or edit it there.
      </p>
      {machineReferenceRows(machine).map((row) => (
        <SetupOwnedValueRow key={row.label} {...row} />
      ))}
    </RailSection>
  );
}

type ReferenceRow = React.ComponentProps<typeof SetupOwnedValueRow>;
function machineReferenceRows(machine: CncMachineConfig): ReadonlyArray<ReferenceRow> {
  return [
    {
      label: 'Stock',
      value: stockLabel(machine),
      description:
        'These are the current job stock dimensions saved in Machine Setup. Artwork cut depth remains an operation setting.',
      setupField: 'stock',
    },
    {
      label: 'Tiling',
      value: tilingLabel(machine),
      description:
        'This current-job tiling plan is configured in Machine Setup. It controls tiled export, not this artwork operation.',
      setupField: 'tiling',
    },
    {
      label: 'Spin-up delay',
      value: `${formatNumber(machine.params.spindleSpinupSec)} s`,
      description:
        'This Machine Setup delay is emitted after spindle start and before the first plunge.',
      setupField: 'spinup',
    },
    {
      label: 'Coolant',
      value: coolantLabel(machine.params.coolant),
      description: 'This machine-wide coolant output is selected in Machine Setup for the job.',
      setupField: 'coolant',
    },
    {
      label: 'Safe Z',
      value: `${formatNumber(machine.params.safeZMm)} mm`,
      description:
        'This is the Machine Setup clearance height above the stock top for rapid travel between cuts.',
      setupField: 'safe-z',
    },
    {
      label: 'Park position',
      value: parkLabel(machine),
      description:
        'This is the Machine Setup park position used after the job and during planned bit changes.',
      setupField: 'park',
    },
  ];
}

function stockLabel(machine: CncMachineConfig): string {
  const { widthMm, heightMm, thicknessMm } = machine.stock;
  return `${formatNumber(widthMm)} x ${formatNumber(heightMm)} x ${formatNumber(thicknessMm)} mm`;
}

function tilingLabel(machine: CncMachineConfig): string {
  const tiling = machine.tiling;
  if (tiling === undefined) return 'Off';
  const holes = tiling.registrationHoles ? ', registration holes' : '';
  return `${formatNumber(tiling.tileWidthMm)} x ${formatNumber(tiling.tileHeightMm)} mm, ${formatNumber(tiling.overlapMm)} mm overlap${holes}`;
}

function parkLabel(machine: CncMachineConfig): string {
  const x = machine.params.parkXMm ?? 0;
  const y = machine.params.parkYMm ?? 0;
  return `X ${formatNumber(x)}, Y ${formatNumber(y)} mm`;
}

function coolantLabel(coolant: CncMachineConfig['params']['coolant']): string {
  if (coolant === 'mist') return 'Mist (M7)';
  if (coolant === 'flood') return 'Flood (M8)';
  return 'Off';
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
