import { usePlatformOptional } from '../app/platform-context';
import { Button, Dialog, DialogActions } from '../kit';
import { AiConnection } from './AiConnection';
import { AiDraftReview } from './AiDraftReview';
import { AiRequestPanel } from './AiRequestPanel';
import { useAiAssistant } from './use-ai-assistant';
import { useAiDialogStore } from './ai-dialog-store';

export function AiAssistantDialogHost(): JSX.Element | null {
  const open = useAiDialogStore((state) => state.open);
  const close = useAiDialogStore((state) => state.close);
  return open ? <AiAssistantDialog onClose={close} /> : null;
}
export function AiAssistantDialog({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const assistant = usePlatformOptional()?.aiAssistant;
  const model = useAiAssistant(assistant, onClose);
  const close = (): void => {
    model.cancel();
    onClose();
  };
  return (
    <Dialog title="AI design and material assistant" size="lg" onClose={close}>
      {assistant === undefined ? (
        <p>
          This connection is available in the desktop app. Local design and material tools remain
          available here.
        </p>
      ) : (
        <>
          <AiConnection
            assistant={assistant}
            status={model.status}
            busy={model.busy}
            onStatus={model.setStatus}
            onError={model.setError}
          />
          <AiRequestPanel model={model} />
        </>
      )}
      {model.error === '' ? null : <p role="alert">{model.error}</p>}
      {model.review === null ? null : (
        <AiDraftReview
          draft={model.review.draft}
          request={model.review.request}
          library={model.review.library}
        />
      )}
      <DialogActions>
        {model.review?.request.task === 'vector' ? (
          <Button
            title="Add this reviewed geometry as editable artwork with one Undo step."
            onClick={model.apply}
          >
            Add reviewed design
          </Button>
        ) : null}
        <Button
          title="Close without adding generated artwork or applying material settings."
          onClick={close}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
