import { useEffect, useRef, useState } from 'react';
import type { TracedImage } from '../../../core/scene';
import type { TraceOptions } from '../../../core/trace';
import type { PreparedTrace } from '../../trace/prepared-trace';
import type { TracePreviewState } from '../../trace/use-trace-preview';
import type { JigTraceControlsProps } from './JigTraceControls';
import { buildJigTraceObject, type JigTraceSource } from './jig-trace-import';
import { jigImageTraceTargets } from './jig-image-trace';

type CommitArgs = JigTraceControlsProps & {
  readonly source: JigTraceSource | null;
  readonly options: TraceOptions;
  readonly preview: TracePreviewState;
};

export function useJigTraceCommit(args: CommitArgs) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const latest = useRef(args);
  latest.current = args;
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setError(null);
    setSuccess(false);
  }, [args.source, args.options]);

  const commit = async (): Promise<void> => {
    const snapshot = latest.current;
    const inputs = pending.current ? null : commitInputs(snapshot);
    if (inputs === null) return;
    if (jigTraceImageMissing(snapshot)) {
      setSuccess(false);
      setError(MISSING_IMAGE);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const object = await buildJigTraceObject({
        ...inputs,
        options: snapshot.options,
        project: snapshot.project,
      });
      if (!mounted.current) return;
      const current = latest.current;
      if (!sameInputs(current, snapshot)) {
        setError('The jig or trace settings changed. Review the preview and trace again.');
        return;
      }
      publishTrace(current, inputs.source, object);
      setSuccess(true);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, error, success, commit };
}

const MISSING_IMAGE =
  'The image being traced is no longer on the jig. Select an image and choose Trace selected image.';

function commitInputs(
  args: CommitArgs,
): { readonly source: JigTraceSource; readonly preparedTrace: PreparedTrace } | null {
  if (args.source === null || args.preview.kind !== 'ready') return null;
  const preparedTrace = args.preview.preparedTrace;
  return preparedTrace === undefined ? null : { source: args.source, preparedTrace };
}

/** True when the trace replaces a jig image that has since been deleted. */
export function jigTraceImageMissing(args: Pick<CommitArgs, 'project' | 'source'>): boolean {
  const image = args.source?.image;
  return image !== undefined && jigImageTraceTargets(args.project.scene, image.id) === null;
}

// An uploaded file is added and fitted; a traced jig image is replaced in place.
function publishTrace(current: CommitArgs, source: JigTraceSource, object: TracedImage): void {
  if (source.image === undefined) current.onImport(object);
  else current.onTraceImage(source.image.id, object);
}

function sameInputs(current: CommitArgs, snapshot: CommitArgs): boolean {
  return (
    current.project === snapshot.project &&
    current.source === snapshot.source &&
    current.options === snapshot.options
  );
}
