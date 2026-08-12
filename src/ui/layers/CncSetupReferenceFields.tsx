import { CHIPLOAD_MATERIALS } from '../../core/cnc';
import type { CncLayerSettings, CncMachineConfig } from '../../core/scene';
import { MANUAL_FEEDS_LABEL } from '../common/cnc-material-vocabulary';
import { useStore } from '../state';
import { SetupOwnedValueRow } from './SetupOwnedValueRow';

/** Effective job and machine values displayed read-only in Artwork settings. */
export function CncSetupReferenceFields(props: {
  readonly settings: CncLayerSettings;
  readonly hasReliefObjects: boolean;
}): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  if (machine?.kind !== 'cnc') return null;
  const rows = setupReferenceRows(machine, props.settings, props.hasReliefObjects);
  return (
    <section aria-label="Values from Startup Setup" style={sectionStyle}>
      <h4 className="lf-subhead" style={headingStyle}>
        From Startup Setup
      </h4>
      <p className="lf-hint" style={hintStyle}>
        Read-only here. Select a value to learn what it controls or edit it at its source.
      </p>
      <div style={rowsStyle}>
        {rows.map((row) => (
          <SetupOwnedValueRow key={row.label} {...row} />
        ))}
      </div>
    </section>
  );
}

type ReferenceRow = React.ComponentProps<typeof SetupOwnedValueRow>;

function setupReferenceRows(
  machine: CncMachineConfig,
  settings: CncLayerSettings,
  hasReliefObjects: boolean,
): ReadonlyArray<ReferenceRow> {
  return [
    {
      label: 'Material',
      value: materialLabel(machine, settings),
      description:
        'This material is assigned in Startup Setup. It supplies starting values; the operation feed, plunge, and depth settings remain editable below.',
      setupField: operationMaterialKey(settings) === undefined ? 'material' : 'tool-plan',
    },
    {
      label: 'Bit',
      value: bitLabel(machine, settings),
      description:
        'This is the cutter assigned by the Startup Setup tool plan. Cutter assignments and the installed default bit are edited there.',
      setupField: settings.toolId === undefined ? 'default-bit' : 'tool-plan',
    },
    ...secondaryToolRows(machine, settings, hasReliefObjects),
    {
      label: 'Stock',
      value: stockLabel(machine),
      description:
        'These are the current job stock dimensions saved in Startup Setup. Artwork cut depth remains an operation setting.',
      setupField: 'stock',
    },
    {
      label: 'Tiling',
      value: tilingLabel(machine),
      description:
        'This current-job tiling plan is configured in Startup Setup. It controls tiled export, not this artwork operation.',
      setupField: 'tiling',
    },
    {
      label: 'Spin-up delay',
      value: `${formatNumber(machine.params.spindleSpinupSec)} s`,
      description:
        'This Startup Setup delay is emitted after spindle start and before the first plunge.',
      setupField: 'spinup',
    },
    {
      label: 'Coolant',
      value: coolantLabel(machine.params.coolant),
      description: 'This machine-wide coolant output is selected in Startup Setup for the job.',
      setupField: 'coolant',
    },
    {
      label: 'Safe Z',
      value: `${formatNumber(machine.params.safeZMm)} mm`,
      description:
        'This is the Startup Setup clearance height above the stock top for rapid travel between cuts.',
      setupField: 'safe-z',
    },
    {
      label: 'Park position',
      value: parkLabel(machine),
      description:
        'This is the Startup Setup park position used after the job and during planned bit changes.',
      setupField: 'park',
    },
  ];
}

function secondaryToolRows(
  machine: CncMachineConfig,
  settings: CncLayerSettings,
  hasReliefObjects: boolean,
): ReadonlyArray<ReferenceRow> {
  return [
    ...(settings.cutType === 'v-carve' && (settings.vCarveFlatDepthEnabled ?? true)
      ? [
          toolPlanRow(
            'Floor clearing bit',
            toolLabel(machine, settings.vClearToolId, 'Single stage (V-bit only)'),
            'This optional flat-floor clearing cutter is assigned in the Startup Setup tool plan.',
          ),
        ]
      : []),
    ...(settings.cutType === 'pocket' && settings.pocketStrategy !== 'adaptive'
      ? [
          toolPlanRow(
            'Pocket roughing bit',
            toolLabel(machine, settings.pocketRoughToolId, 'Single bit'),
            'This optional larger roughing cutter is assigned in the Startup Setup tool plan.',
          ),
        ]
      : []),
    ...(hasReliefObjects
      ? [
          toolPlanRow(
            'Relief finishing bit',
            toolLabel(machine, settings.reliefFinishToolId, 'Roughing only'),
            'This optional relief finishing cutter is assigned in the Startup Setup tool plan. Scallop height remains editable below.',
          ),
        ]
      : []),
  ];
}

function toolPlanRow(label: string, value: string, description: string): ReferenceRow {
  return { label, value, description, setupField: 'tool-plan' };
}

function materialLabel(machine: CncMachineConfig, settings: CncLayerSettings): string {
  const sourceKey = operationMaterialKey(settings) ?? machine.stock.materialKey;
  if (sourceKey === undefined) return MANUAL_FEEDS_LABEL;
  const label = CHIPLOAD_MATERIALS.find((material) => material.value === sourceKey)?.label;
  return label ?? sourceKey;
}

function operationMaterialKey(settings: CncLayerSettings): string | undefined {
  if (settings.materialKey !== undefined) return settings.materialKey;
  return settings.feedSource?.kind === 'material-recipe'
    ? settings.feedSource.materialKey
    : undefined;
}

function bitLabel(machine: CncMachineConfig, settings: CncLayerSettings): string {
  const suffix = settings.toolId === undefined ? 'default' : 'tool plan';
  const toolId = settings.toolId ?? machine.toolId;
  return `${toolLabel(machine, toolId, 'No bit assigned')} (${suffix})`;
}

function toolLabel(machine: CncMachineConfig, toolId: string | undefined, empty: string): string {
  if (toolId === undefined) return empty;
  return machine.tools.find((tool) => tool.id === toolId)?.name ?? `Unavailable bit (${toolId})`;
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

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 6,
};

const headingStyle: React.CSSProperties = { marginBottom: 0 };

const hintStyle: React.CSSProperties = { margin: '0 0 2px 0' };

const rowsStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
