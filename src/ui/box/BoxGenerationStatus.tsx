import { useEffect, useState, type CSSProperties } from 'react';
import { Button } from '../kit';
import { boxEstimateIsLarge } from './box-preview-responsiveness';
import type { BoxGenerationState } from './use-box-generation';

const PENDING_MESSAGE_DELAY_MS = 50;

export function BoxGenerationStatus(props: {
  readonly state: BoxGenerationState;
  readonly staleMessage: string | null;
  readonly isPreviewSuppressed: boolean;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
}): JSX.Element | null {
  const pendingRequestId = props.state.kind === 'pending' ? props.state.requestId : null;
  const isPendingMessageVisible = useDelayedPendingMessage(pendingRequestId);
  const messages = statusMessages(
    props.state,
    props.staleMessage,
    props.isPreviewSuppressed,
    isPendingMessageVisible,
  );
  const action =
    props.state.kind === 'pending' ? (
      <Button onClick={props.onCancel}>Cancel preview generation</Button>
    ) : props.state.kind === 'failed' || props.state.kind === 'cancelled' ? (
      <Button onClick={props.onRetry}>Retry preview generation</Button>
    ) : null;
  if (messages.length === 0 && action === null) return null;
  return (
    <div role="status" aria-live="polite" aria-atomic="true" style={statusStyle}>
      {messages.map((message) => (
        <p key={message} style={messageStyle}>
          {message}
        </p>
      ))}
      {action}
    </div>
  );
}

function useDelayedPendingMessage(requestId: number | null): boolean {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    setIsVisible(false);
    if (requestId === null) return;
    const timer = setTimeout(() => setIsVisible(true), PENDING_MESSAGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [requestId]);
  return isVisible;
}

function statusMessages(
  state: BoxGenerationState,
  staleMessage: string | null,
  isPreviewSuppressed: boolean,
  isPendingMessageVisible: boolean,
): string[] {
  const messages = staleMessage === null ? [] : [staleMessage];
  if (state.kind === 'pending' && isPendingMessageVisible) {
    messages.push('Generating preview for current values.');
  }
  if (state.kind === 'cancelled') messages.push('Preview generation cancelled.');
  if (state.kind === 'ready' && isPreviewSuppressed) {
    messages.push(
      'Geometry is ready. Visual preview is hidden for responsiveness; Generate uses the complete current geometry.',
    );
  }
  const estimate =
    state.kind === 'ready' ? state.snapshot.estimate : 'estimate' in state ? state.estimate : null;
  if (estimate !== null && boxEstimateIsLarge(estimate)) {
    messages.push(
      estimate.saturatedFields.length > 0
        ? 'Design complexity is beyond a precise estimate. Generation remains available and cancellable.'
        : 'This is a large design. Background generation may take longer and remains cancellable.',
    );
  }
  return messages;
}

const statusStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  marginTop: 6,
};

const messageStyle: CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  margin: 0,
};
