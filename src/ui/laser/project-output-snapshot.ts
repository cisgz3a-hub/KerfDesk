import type { Project } from '../../core/scene';
import type { OutputSnapshotRequest } from './output-preparation-protocol';
import { currentPrintCutOutputRegistration } from './print-cut-output';

/** Capture before a picker/worker await so queue latency cannot change text. */
export function captureProjectOutputSnapshot(project: Project): OutputSnapshotRequest | undefined {
  const registration = currentPrintCutOutputRegistration(project);
  const hasVariables = project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
  if (!hasVariables && registration === undefined) return undefined;
  return {
    evaluatedAtIso: new Date().toISOString(),
    ...(registration === undefined ? {} : { registration }),
  };
}
