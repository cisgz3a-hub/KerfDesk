// JobReviewDialog — the pre-start Job Review window (ADR-224). Opens for
// every Start that goes through the shared start flow, shows everything the
// burn depends on (stats from the exact prepared G-code, editable operation
// numbers and placement, live controller/machine facts, warnings, and the
// absorbed safety acknowledgement), and hands the operator's Confirm/Cancel
// back to the flow's review gate. Mounted once at the App level; renders
// null until the gate opens a request.

import { useEffect, useRef, type RefObject } from 'react';
import { Button, Dialog, DialogActions } from '../../kit';
import { useJobReviewStore, type JobReviewState } from './job-review-store';
import { bannerListStyle, bannerStyle } from './job-review.styles';
import { JobReviewAcknowledgement } from './JobReviewAcknowledgement';
import { JobReviewControllerSection } from './JobReviewControllerSection';
import { JobReviewHeader } from './JobReviewHeader';
import { JobReviewLayersTable } from './JobReviewLayersTable';
import { JobReviewMachineSection } from './JobReviewMachineSection';
import { JobReviewPlacement } from './JobReviewPlacement';
import { JobReviewStats } from './JobReviewStats';
import { JobReviewWarnings } from './JobReviewWarnings';
import { useJobReviewRebuildTrigger } from './use-job-review-rebuild';

export function JobReviewDialog(): JSX.Element | null {
  const state = useJobReviewStore((s) => s.state);
  if (state.kind === 'idle') return null;
  return <OpenJobReview state={state} />;
}

function OpenJobReview(props: {
  readonly state: Extract<JobReviewState, { readonly kind: 'open' }>;
}): JSX.Element {
  const { model, isPreparing, blocker } = props.state;
  const topAnchorRef = useRef<HTMLSpanElement>(null);
  useJobReviewRebuildTrigger();
  useReviewInitialFocus(topAnchorRef);
  const handleCancel = (): void => useJobReviewStore.getState().cancel();
  const handleConfirm = (): void => useJobReviewStore.getState().confirm();
  const startDisabledReason = isPreparing
    ? 'Recomputing the job with your latest edits — one moment.'
    : blocker !== null
      ? blocker.join('\n')
      : null;
  return (
    <Dialog title="Review job before starting" size="xl" onClose={handleCancel}>
      <span ref={topAnchorRef} aria-hidden="true" />
      <JobReviewHeader machineKind={model.machineKind} />
      <JobReviewStats stats={model.stats} isPreparing={isPreparing} />
      {blocker !== null ? <BlockerBanner blocker={blocker} /> : null}
      <JobReviewWarnings warnings={model.warnings} />
      <JobReviewLayersTable machineKind={model.machineKind} />
      <JobReviewPlacement
        resolvedOriginLabel={model.resolvedOriginLabel}
        isPreparing={isPreparing}
      />
      <JobReviewControllerSection machineKind={model.machineKind} />
      <JobReviewMachineSection
        machineKind={model.machineKind}
        toolPlanLabels={model.toolPlanLabels}
      />
      <JobReviewAcknowledgement acknowledgement={model.acknowledgement} />
      <DialogActions>
        <Button
          onClick={handleCancel}
          title="Close this review without starting. Edits made here are kept."
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={startDisabledReason !== null}
          title={startDisabledReason ?? 'Start this job now with the settings shown above.'}
          onClick={handleConfirm}
        >
          Start job
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// The kit's dialog a11y focuses the first focusable child — here that is a
// power input two sections down, which both opens the review scrolled past
// its header and lets a stray keystroke edit a setting sight-unseen. A
// review opens as a document: show it from the top and focus the dialog
// surface itself (still inside the focus trap; Tab reaches the fields next).
// One animation frame later than the kit's focus so this wins the race.
function useReviewInitialFocus(anchor: RefObject<HTMLElement>): void {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = anchor.current;
      if (node === null) return;
      const panel = node.closest('.lf-dialog');
      if (panel instanceof HTMLElement) panel.scrollTop = 0;
      const backdrop = node.closest('.lf-dialog-backdrop');
      if (backdrop instanceof HTMLElement) backdrop.focus();
    });
    return (): void => window.cancelAnimationFrame(frame);
  }, [anchor]);
}

function BlockerBanner(props: { readonly blocker: ReadonlyArray<string> }): JSX.Element {
  return (
    <div role="alert" className="lf-banner lf-banner--danger" style={bannerStyle}>
      <strong>Cannot start this job as edited</strong>
      <ul style={bannerListStyle}>
        {props.blocker.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
