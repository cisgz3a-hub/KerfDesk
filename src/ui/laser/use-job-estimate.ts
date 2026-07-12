// useJobEstimate — debounced live ETA for the current scene + device.
//
// H16 (AUDIT-2026-06-10): the estimate used to recompute synchronously per
// project identity, and setObjectTransform replaces the project on EVERY
// pointer-move — so dragging an object re-ran compile (including the raster
// base64-decode + resample + dither pipeline, bounded only by the 4M px
// budget) once per mousemove on the main thread. A trailing debounce keeps
// the badge fresh ~a quarter second after the user stops moving, while a
// drag costs zero recompiles.

import { useEffect, useState } from 'react';
import type { Project } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import {
  estimateLiveJob,
  estimateLiveJobSnapshot,
  type LiveJobEstimate,
} from './live-job-estimate';
import { renderVariableText } from '../text/render-variable-text';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';

export const JOB_ESTIMATE_DEBOUNCE_MS = 250;

type Settled = {
  readonly project: Project | null;
  readonly outputScopeKey: string;
  readonly registrationKey: string;
  readonly estimate: LiveJobEstimate;
};

export function useJobEstimate(): LiveJobEstimate {
  const project = useStore((s) => s.project);
  const outputScope = useStore((s) => currentOutputScope(s));
  const outputScopeKey = JSON.stringify(outputScope);
  const positionEpoch = useLaserStore((state) => state.trustedPositionEpoch ?? 0);
  const firstRegistrationPoint = usePrintCutSessionStore((state) => state.first);
  const secondRegistrationPoint = usePrintCutSessionStore((state) => state.second);
  const registrationKey = JSON.stringify({
    positionEpoch,
    firstRegistrationPoint,
    secondRegistrationPoint,
  });
  const initialRegistration = currentPrintCutOutputRegistration(project);
  const initiallyAsync = hasVariableText(project) || initialRegistration !== undefined;
  // First render computes synchronously so the badge is present on load;
  // later project mutations re-estimate only after a quiet period.
  const [settled, setSettled] = useState<Settled>(() => ({
    project: initiallyAsync ? null : project,
    outputScopeKey,
    registrationKey,
    estimate: estimateLiveJob(project, outputScope),
  }));
  useEffect(() => {
    if (
      settled.project === project &&
      settled.outputScopeKey === outputScopeKey &&
      settled.registrationKey === registrationKey
    ) {
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      const registration = currentPrintCutOutputRegistration(project);
      const estimate =
        hasVariableText(project) || registration !== undefined
          ? estimateLiveJobSnapshot(
              project,
              outputScope,
              () => new Date(),
              renderVariableText,
              registration,
            )
          : Promise.resolve(estimateLiveJob(project, outputScope));
      void estimate.then((value) => {
        if (!cancelled) setSettled({ project, outputScopeKey, registrationKey, estimate: value });
      });
    }, JOB_ESTIMATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [
    project,
    outputScope,
    outputScopeKey,
    settled.project,
    settled.outputScopeKey,
    settled.registrationKey,
    registrationKey,
    positionEpoch,
    firstRegistrationPoint,
    secondRegistrationPoint,
  ]);
  return settled.estimate;
}

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
}
