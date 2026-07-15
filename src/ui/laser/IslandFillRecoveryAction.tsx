import { useMemo } from 'react';
import { analyzeFillHeatRisk, compileJob, islandFillMotionPolicyForDevice } from '../../core/job';
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
  const switchIslandFillLayersToScanline = useStore((s) => s.switchIslandFillLayersToScanline);
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
      <strong>4040 Island Fill risk</strong>
      <p style={islandFillRecoveryTextStyle}>
        Island Fill can darken fine details on this profile. Scanline is safer for final 4040 burns.
      </p>
      <button
        type="button"
        onClick={() => {
          switchIslandFillLayersToScanline();
          pushToast('Switched Island Fill layers to Scanline.', 'success');
        }}
        disabled={streaming}
        title="Switch Island Fill layers to Scanline Fill for safer 4040 output."
      >
        Switch Island Fill to Scanline
      </button>
    </div>
  );
}

function hasMachineIslandFillRisk(project: Project, outputScope: OutputScope): boolean {
  if (!hasPotentialSensitiveIslandFillRisk(project)) return false;
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return false;
  const scopedProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };
  const job = compileJob(scopedProject.scene, scopedProject.device);
  const heatRisk = analyzeFillHeatRisk(job);
  return (
    heatRisk.sensitiveIslandShortSweepCount > 0 ||
    heatRisk.islandNoRunwayShortSweepCount > 0 ||
    job.groups.some(
      (group) => group.kind === 'fill' && group.fillStyle === 'island' && group.overscanMm <= 0,
    )
  );
}

function hasPotentialSensitiveIslandFillRisk(project: Project): boolean {
  return (
    islandFillMotionPolicyForDevice(project.device) === 'sensitive' &&
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
