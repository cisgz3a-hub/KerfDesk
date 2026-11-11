// Reads the guided first job's signals from real state (ADR-698): the
// controller connection, the saved Machine Setup marks, the scene, the material
// library, the same Frame evidence Start uses, and the streamer. Read-only.

import { useEffect, useState } from 'react';
import { machineKindOf, sceneObjectUsesOperation, type Project } from '../../core/scene';
import type { MaterialLibraryDocument } from '../../io/material-library';
import { deviceProfileSignature } from '../laser/device-setup/device-setup-nudge';
import { useMachineSetupDialogStore } from '../laser/device-setup/machine-setup-dialog-store';
import { currentCompletedFrame, framedRunReadinessIssue } from '../laser/framed-run-readiness';
import { useExecutionSignatureAppState } from '../laser/use-execution-signature-app-state';
import { useFramedRunLaserState } from '../laser/use-framed-run-laser-state';
import { useStore } from '../state';
import {
  browserLocalStorage,
  loadConfiguredSignatures,
} from '../state/device-setup-configured-persistence';
import { useLaserStore } from '../state/laser-store';
import { recipeMatchesLayer } from '../state/material-library-actions';
import type { FirstJobSignals } from './first-job-steps';
import { useFirstJobGuideStore } from './first-job-guide-store';

const JOB_RUNNING: ReadonlySet<string> = new Set(['streaming', 'paused', 'tool-change']);

export function useFirstJobSignals(): FirstJobSignals {
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const project = useStore((s) => s.project);
  const library = useStore((s) => s.materialLibrary);
  const app = useExecutionSignatureAppState();
  const laser = useFramedRunLaserState();
  const running = useLaserStore((s) => JOB_RUNNING.has(s.streamer?.status ?? 'idle'));
  const jobStarted = useFirstJobGuideStore((s) => s.jobStarted);
  const markJobStarted = useFirstJobGuideStore((s) => s.markJobStarted);
  // A short job can stream and finish between two renders, so the latch
  // listens to the store itself rather than to what a render saw.
  useEffect(() => {
    const check = (state: ReturnType<typeof useLaserStore.getState>): void => {
      if (JOB_RUNNING.has(state.streamer?.status ?? 'idle')) markJobStarted();
    };
    check(useLaserStore.getState());
    return useLaserStore.subscribe(check);
  }, [markJobStarted]);
  return {
    connected,
    machineConfigured: useMachineConfigured(project),
    hasArtwork: project.scene.objects.length > 0,
    materialChosen: materialChosen(project, library),
    framedReady: framedRunReadinessIssue(currentCompletedFrame(laser), app, laser) === null,
    jobStarted: jobStarted || running,
  };
}

function useMachineConfigured(project: Project): boolean {
  const revision = useMachineSetupDialogStore((store) => store.configuredRevision);
  const [configured, setConfigured] = useState<ReadonlySet<string>>(readConfigured);
  useEffect(() => setConfigured(readConfigured()), [revision]);
  return configured.has(deviceProfileSignature(project.device, machineKindOf(project.machine)));
}

function readConfigured(): ReadonlySet<string> {
  const storage = browserLocalStorage();
  return storage === null ? new Set() : loadConfiguredSignatures(storage);
}

/** A job material is chosen, or an output operation that artwork uses holds or
 *  links a preset of the open library. */
export function materialChosen(project: Project, library: MaterialLibraryDocument | null): boolean {
  if (project.jobSetup.laserMaterial !== undefined) return true;
  const used = project.scene.layers.filter(
    (layer) =>
      layer.output &&
      project.scene.objects.some((object) => sceneObjectUsesOperation(object, layer)),
  );
  return used.some(
    (layer) =>
      layer.materialBinding !== undefined ||
      (library?.entries.some((entry) => recipeMatchesLayer(layer, entry.recipe)) ?? false),
  );
}
