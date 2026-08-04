import { useMemo } from 'react';
import { analyzeFillHeatRisk, compileJob, islandFillMotionPolicyForDevice } from '../../core/job';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  validateOutputScope,
  type OutputScope,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';

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
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return false;
  const scopedProject =
    scoped.scene === project.scene ? project : { ...project, scene: scoped.scene };
  if (!hasPotentialSensitiveIslandFillRisk(scopedProject)) return false;
  // Island Fill itself is classified as costly. Keep the recovery action
  // visible from the cheap, conservative predicate instead of either running
  // its exact sweep analysis during render or hiding an existing safety aid.
  if (costlyCanvasPreparation(scopedProject)) return true;
  const job = compileJob(scopedProject.scene, scopedProject.device);
  const heatRisk = analyzeFillHeatRisk(job, scopedProject.device.scanningOffsets);
  return (
    heatRisk.sensitiveIslandShortSweepCount > 0 ||
    heatRisk.islandNoRunwayShortSweepCount > 0 ||
    job.groups.some(
      (group) => group.kind === 'fill' && group.fillStyle === 'island' && group.overscanMm <= 0,
    )
  );
}

function hasPotentialSensitiveIslandFillRisk(project: Project): boolean {
  if (islandFillMotionPolicyForDevice(project.device) !== 'sensitive') return false;
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  return project.scene.objects.some((object) =>
    operations.some((layer) => {
      if (!sceneObjectUsesOperation(object, layer)) return false;
      const settings =
        object.operationOverride === undefined ? layer : { ...layer, ...object.operationOverride };
      return settings.mode === 'fill' && settings.fillStyle === 'island';
    }),
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
