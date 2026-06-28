import { useMemo } from 'react';
import {
  findMachineProfilePreflightIssues,
  MACHINE_ISLAND_FILL_RISK_CODE,
} from '../../core/preflight';
import { validateOutputScope, type OutputScope, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

export function IslandFillRecoveryAction({
  streaming,
}: {
  readonly streaming: boolean;
}): JSX.Element | null {
  const project = useStore((s) => s.project);
  const outputScopeSettings = useStore((s) => s.outputScopeSettings);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const pushToast = useToastStore((s) => s.pushToast);
  const outputScope = useMemo<OutputScope>(
    () => ({
      cutSelectedGraphics: outputScopeSettings.cutSelectedGraphics,
      useSelectionOrigin: outputScopeSettings.useSelectionOrigin,
      selectedObjectIds: [
        ...(selectedObjectId === null ? [] : [selectedObjectId]),
        ...additionalSelectedIds,
      ],
    }),
    [
      additionalSelectedIds,
      outputScopeSettings.cutSelectedGraphics,
      outputScopeSettings.useSelectionOrigin,
      selectedObjectId,
    ],
  );
  const hasRisk = useMemo(
    () => hasMachineIslandFillRisk(project, outputScope),
    [outputScope, project],
  );
  if (!hasRisk) return null;
  return (
    <div style={islandFillRecoveryStyle} role="alert">
      <strong>4040 Island Fill runway</strong>
      <p style={islandFillRecoveryTextStyle}>
        Island Fill can run on this profile, but it needs laser-off overscan runway.
      </p>
      <button
        type="button"
        onClick={() => {
          for (const layer of project.scene.layers) {
            if (layer.output && layer.mode === 'fill' && layer.fillStyle === 'island') {
              setLayerParam(layer.id, { fillOverscanMm: Math.max(layer.fillOverscanMm, 5) });
            }
          }
          pushToast('Set Island Fill overscan to 5 mm.', 'success');
        }}
        disabled={streaming}
        title="Set every output Island Fill layer to at least 5 mm fill overscan."
      >
        Set Island Fill overscan to 5 mm
      </button>
    </div>
  );
}

function hasMachineIslandFillRisk(project: Project, outputScope: OutputScope): boolean {
  if (!hasPotential4040IslandFillRisk(project)) return false;
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return false;
  const scopedProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };
  return findMachineProfilePreflightIssues(scopedProject).some(
    (issue) => issue.code === MACHINE_ISLAND_FILL_RISK_CODE,
  );
}

function hasPotential4040IslandFillRisk(project: Project): boolean {
  const isNeotronics4040 =
    project.device.machineFamily === 'neotronics-4040-max' ||
    project.device.profileId === 'neotronics-4040-max-lt4lds-v2-20w';
  return (
    isNeotronics4040 &&
    project.scene.layers.some(
      (layer) => layer.output && layer.mode === 'fill' && layer.fillStyle === 'island',
    )
  );
}

const islandFillRecoveryStyle = {
  border: '1px solid var(--lf-warning)',
  background: 'var(--lf-tint-warning)',
  color: 'var(--lf-warning-fg)',
  padding: 8,
  borderRadius: 4,
};

const islandFillRecoveryTextStyle = {
  margin: '4px 0 8px',
};
