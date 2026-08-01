import { useEffect, useState, type CSSProperties } from 'react';
import type { estimateBoxWork } from '../../core/box';
import { Button } from '../kit';
import { boxEstimateIsLarge } from './box-preview-responsiveness';
import type { BoxGenerationState } from './use-box-generation';

const PENDING_MESSAGE_DELAY_MS = 50;
type BoxWorkEstimate = ReturnType<typeof estimateBoxWork>;

export function BoxGenerationStatus(props: {
  readonly state: BoxGenerationState;
  readonly staleMessage: string | null;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
}): JSX.Element | null {
  const pendingRequestId = props.state.kind === 'pending' ? props.state.requestId : null;
  const isPendingMessageVisible = useDelayedPendingMessage(pendingRequestId);
  const messages = statusMessages(props.state, props.staleMessage, isPendingMessageVisible);
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
  isPendingMessageVisible: boolean,
): string[] {
  const messages = staleMessage === null ? [] : [staleMessage];
  if (state.kind === 'pending' && isPendingMessageVisible) {
    messages.push('Generating preview for current values.');
  }
  if (state.kind === 'cancelled') messages.push('Preview generation cancelled.');
  if (state.kind === 'ready' && state.snapshot.generationMode === 'synchronous-fallback') {
    messages.push(
      'Background generation was unavailable, so this preview was generated synchronously. Complex designs may temporarily make the app unresponsive.',
    );
  }
  if (state.kind === 'failed' && state.generationMode === 'synchronous-fallback') {
    messages.push(
      'Background generation was unavailable, so this attempt ran synchronously. Retrying complex designs may temporarily make the app unresponsive.',
    );
  }
  const estimate =
    state.kind === 'ready' ? state.snapshot.estimate : 'estimate' in state ? state.estimate : null;
  const largeDesignMessage = messageForLargeDesign(state, estimate);
  if (largeDesignMessage !== null) messages.push(largeDesignMessage);
  return messages;
}

function messageForLargeDesign(
  state: BoxGenerationState,
  estimate: BoxWorkEstimate | null,
): string | null {
  if (estimate === null || !boxEstimateIsLarge(estimate)) return null;
  const wasImprecise = estimate.saturatedFields.length > 0;
  if (state.kind === 'pending') {
    return wasImprecise
      ? 'Design complexity is beyond a precise estimate. Generation remains available and cancellable.'
      : 'This is a large design. Background generation may take longer and remains cancellable.';
  }
  if (state.kind === 'ready' && state.snapshot.generationMode === 'worker') {
    return wasImprecise
      ? 'Design complexity was beyond a precise estimate. Preview interactions may take longer.'
      : 'This is a large design. Preview interactions may take longer.';
  }
  return null;
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
