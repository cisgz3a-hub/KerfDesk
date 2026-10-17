import { useEffect, useRef, useState } from 'react';
import type { TraceOptions } from '../../../core/trace';
import type { TracePreviewState } from '../../trace/use-trace-preview';
import type { JigTraceControlsProps } from './JigTraceControls';
import { buildJigTraceObject, type JigTraceSource } from './jig-trace-import';

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
    if (
      pending.current ||
      snapshot.source === null ||
      snapshot.preview.kind !== 'ready' ||
      snapshot.preview.preparedTrace === undefined
    )
      return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const object = await buildJigTraceObject({
        source: snapshot.source,
        options: snapshot.options,
        preparedTrace: snapshot.preview.preparedTrace,
        project: snapshot.project,
      });
      if (!mounted.current) return;
      const current = latest.current;
      if (!sameInputs(current, snapshot)) {
        setError('The jig or trace settings changed. Review the preview and trace again.');
        return;
      }
      current.onImport(object);
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

function sameInputs(current: CommitArgs, snapshot: CommitArgs): boolean {
  return (
    current.project === snapshot.project &&
    current.source === snapshot.source &&
    current.options === snapshot.options
  );
}
