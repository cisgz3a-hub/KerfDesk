import { useEffect, useRef, useState } from 'react';
import { restoreDialogFocus } from '../../common/recover-dialog-focus';
import { Dialog, DialogActions } from '../../kit';
import { useLaserStore } from '../../state/laser-store';
import {
  useLaserSecondPassUiStore,
  type SecondPassEditorRequest,
} from '../../state/laser-second-pass-ui-store';
import {
  recoveryRepository,
  type ExecutionArtifactV1,
  type RecoveryRepository,
} from '../../state/recovery';
import { SecondPassCompletionPrompt } from './SecondPassCompletionPrompt';
import { SecondPassWorkbench } from './SecondPassWorkbench';
import { anotherRunHoldsTheStream } from './second-pass-offer';
import { openRetainedSecondPassSource } from './second-pass-source';

/** App-shell ownership keeps the prompt and editor available with collapsed
 * rails. The Machine-panel button and the completion prompt both bind the run
 * that just finished. */
export function SecondPassHost(props: { repository?: RecoveryRepository }): JSX.Element {
  const repository = props.repository ?? recoveryRepository;
  const request = useLaserSecondPassUiStore((s) => s.editorRequest);
  return (
    <>
      <SecondPassCompletionPrompt repository={repository} />
      {request ? (
        <SecondPassEditor key={request.runId} request={request} repository={repository} />
      ) : null}
    </>
  );
}

function SecondPassEditor(props: {
  request: SecondPassEditorRequest;
  repository: RecoveryRepository;
}): JSX.Element {
  const { request, repository } = props;
  const closeEditor = useLaserSecondPassUiStore((s) => s.closeEditor);
  const [source, setSource] = useState<ExecutionArtifactV1 | null>(null);
  const [error, setError] = useState('');
  const scope = useSecondPassFocusReturn(request);
  useEffect(() => {
    let active = true;
    let opening = true;
    // A newer run holding the stream supersedes this opening. An aborted run's
    // leftover activeRunId does not: it closed the editor the moment the
    // Machine-panel button opened it (ADR-341 Amendment 4).
    const cancelSupersededOpening = (): void => {
      if (opening && anotherRunHoldsTheStream(useLaserStore.getState(), request.runId)) {
        active = false;
        closeEditor(request);
      }
    };
    const unsubscribe = useLaserStore.subscribe(cancelSupersededOpening);
    cancelSupersededOpening();
    setSource(null);
    setError('');
    void openRetainedSecondPassSource(request.runId, repository)
      .then((value) => {
        opening = false;
        if (active) setSource(value);
      })
      .catch((reason: unknown) => {
        opening = false;
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [request, repository, closeEditor]);
  const close = (): void => closeEditor(request);
  return (
    <div ref={scope}>
      {source ? (
        <SecondPassWorkbench source={source} onClose={close} />
      ) : (
        <Dialog title="Paint a second pass" size="sm" onClose={close}>
          {error ? <p role="alert">{error}</p> : <p role="status">Opening saved job…</p>}
          <DialogActions>
            <button
              className="lf-btn"
              onClick={close}
              title="Close this window without changing the saved job or moving the machine."
            >
              Close
            </button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}

function useSecondPassFocusReturn(request: SecondPassEditorRequest) {
  const scope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scope.current;
    return () => {
      // Prompt, archive loading and workbench are successive dialogs. Restore
      // the original workspace opener only after their cleanup has completed;
      // the shared helper yields to a newer modal or deliberate focus move.
      queueMicrotask(() => {
        if (node) restoreDialogFocus(node, request.returnFocusTo);
      });
    };
  }, [request]);
  return scope;
}
