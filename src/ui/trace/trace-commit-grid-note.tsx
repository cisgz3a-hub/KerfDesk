// Dialog wiring for the commit working grid (ADR-401): the context a commit
// plans from, and the note telling the operator that Trace will commit a finer
// grid than the preview shows. The note reads only the image header.

import { useEffect, useMemo, useState } from 'react';
import type { RasterImage } from '../../core/scene';
import type { TraceOptions } from '../../core/trace';
import { useStore } from '../state';
import { readImageNaturalSize, type ImageDimensions } from './image-loader';
import { browserDeviceMemoryGb } from './trace-commit-at-grid';
import {
  describeTraceCommitGrid,
  planTraceCommitGridFor,
  traceCommitGridContext,
  type TraceCommitGridContext,
} from './trace-commit-grid';
import type { TraceCommitClaim } from './trace-commit-ownership';
import type { TracePreviewState } from './use-trace-preview';

/** The grid context for the live source and project a commit has claimed;
 *  undefined (the preview grid) when the claim is gone. */
export function traceCommitGridForClaim(
  claim: TraceCommitClaim | null,
): TraceCommitGridContext | undefined {
  if (claim === null) return undefined;
  return traceCommitGridContext(claim.source, claim.project, browserDeviceMemoryGb());
}

export function TraceCommitGridNote(props: {
  readonly preview: TracePreviewState;
  readonly source: RasterImage;
}): JSX.Element | null {
  const request = props.preview.kind === 'ready' ? props.preview.preparedTrace?.request : undefined;
  const note = useTraceCommitGridNote(request?.file ?? null, props.source, request?.options);
  return note === null ? null : (
    <p className="lf-trace-hint" role="note">
      {note}
    </p>
  );
}

function useTraceCommitGridNote(
  file: File | null,
  source: RasterImage,
  options: TraceOptions | undefined,
): string | null {
  const device = useStore((s) => s.project.device);
  const machineKind = useStore((s) => s.project.machine?.kind);
  const native = useNaturalSize(file);
  return useMemo(() => {
    if (native === null || options === undefined) return null;
    const machine = machineKind === undefined ? undefined : { kind: machineKind };
    const context = traceCommitGridContext(source, { device, machine }, browserDeviceMemoryGb());
    const plan = planTraceCommitGridFor(native, context, options);
    return plan === null ? null : describeTraceCommitGrid(plan);
  }, [native, source, device, machineKind, options]);
}

function useNaturalSize(file: File | null): ImageDimensions | null {
  const [known, setKnown] = useState<{ readonly file: File; readonly size: ImageDimensions }>();
  useEffect(() => {
    if (file === null) return undefined;
    const controller = new AbortController();
    // Started from a resolved promise so a synchronous throw is a rejection too.
    void Promise.resolve()
      .then(() => readImageNaturalSize(file, controller.signal))
      .then(
        (size) => {
          if (!controller.signal.aborted) setKnown({ file, size });
        },
        // Informational only: the commit reports any decode failure itself.
        () => undefined,
      );
    return () => controller.abort();
  }, [file]);
  return known !== undefined && known.file === file ? known.size : null;
}
