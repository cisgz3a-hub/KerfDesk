// JobReviewDialog — the pre-start Job Review window (ADR-224). Opens for
// every Start that goes through the shared start flow, shows everything the
// burn depends on (stats from the exact prepared G-code, grouped warnings,
// editable artwork settings with per-mode detail lines, CNC material &
// stock, live controller/machine facts, and the absorbed safety
// acknowledgement), and hands the operator's Confirm/Cancel back to the
// flow's review gate. Placement is read-only here (v2): the origin tile and
// the footer fact echo it, editing stays on the machine rail.

import { useEffect, useRef, type RefObject } from 'react';
import { Button, Dialog, Icon } from '../../kit';
import { useJobReviewStore, type JobReviewPurpose, type JobReviewState } from './job-review-store';
import {
  bannerListStyle,
  bannerStyle,
  footerBarStyle,
  footerOriginStyle,
  sectionHeadingStyle,
  sectionStyle,
  startButtonContentStyle,
} from './job-review.styles';
import { JobReviewAcknowledgement } from './JobReviewAcknowledgement';
import { JobReviewControllerSection } from './JobReviewControllerSection';
import { JobReviewHeader } from './JobReviewHeader';
import { JobReviewLayersTable } from './JobReviewLayersTable';
import { JobReviewMachineSection } from './JobReviewMachineSection';
import { JobReviewStats } from './JobReviewStats';
import { JobReviewStockCard } from './JobReviewStockCard';
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
  const { model, purpose, isPreparing, blocker } = props.state;
  const copy = reviewCopy(purpose);
  const topAnchorRef = useRef<HTMLSpanElement>(null);
  useJobReviewRebuildTrigger();
  useReviewInitialFocus(topAnchorRef);
  const handleCancel = (): void => useJobReviewStore.getState().cancel();
  const handleConfirm = (): void => useJobReviewStore.getState().confirm();
  const startDisabledReason = isPreparing
    ? copy.preparingTitle
    : blocker !== null
      ? blocker.join('\n')
      : null;
  return (
    <Dialog title={copy.dialogTitle} size="xl" onClose={handleCancel}>
      <span ref={topAnchorRef} aria-hidden="true" />
      <JobReviewHeader machineKind={model.machineKind} />
      <JobReviewStats stats={model.stats} isPreparing={isPreparing} />
      {blocker !== null ? <BlockerBanner blocker={blocker} purpose={purpose} /> : null}
      <JobReviewWarnings warnings={model.warnings} />
      <JobReviewStockCard />
      <JobReviewLayersTable machineKind={model.machineKind} />
      <section aria-label="Before you start" style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Before you start</h3>
        <JobReviewControllerSection machineKind={model.machineKind} />
        <JobReviewMachineSection
          machineKind={model.machineKind}
          toolPlanLabels={model.toolPlanLabels}
        />
      </section>
      <JobReviewAcknowledgement acknowledgement={model.acknowledgement} purpose={purpose} />
      <div style={footerBarStyle}>
        <span
          style={{ ...footerOriginStyle, opacity: isPreparing ? 0.55 : 1 }}
          title="The origin the shown G-code runs from. To change placement, cancel and set it on the machine rail."
        >
          Runs from <strong>{model.resolvedOriginLabel}</strong>
        </span>
        <Button onClick={handleCancel} title={copy.cancelTitle}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={startDisabledReason !== null}
          title={startDisabledReason ?? copy.confirmTitle}
          onClick={handleConfirm}
        >
          <span style={startButtonContentStyle}>
            <Icon name="play" size={11} />
            {copy.confirmLabel}
          </span>
        </Button>
      </div>
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

function BlockerBanner(props: {
  readonly blocker: ReadonlyArray<string>;
  readonly purpose: JobReviewPurpose;
}): JSX.Element {
  return (
    <div role="alert" className="lf-banner lf-banner--danger" style={bannerStyle}>
      <strong>
        {props.purpose === 'frame'
          ? 'Cannot frame this job as edited'
          : 'Cannot start this job as edited'}
      </strong>
      <ul style={bannerListStyle}>
        {props.blocker.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

type JobReviewCopy = {
  readonly dialogTitle: string;
  readonly preparingTitle: string;
  readonly cancelTitle: string;
  readonly confirmTitle: string;
  readonly confirmLabel: string;
};

function reviewCopy(purpose: JobReviewPurpose): JobReviewCopy {
  if (purpose === 'frame') {
    return {
      dialogTitle: 'Review job before framing',
      preparingTitle: 'Recomputing the job with your latest edits before framing — one moment.',
      cancelTitle: 'Close this review without framing. Edits made here are kept.',
      confirmTitle: 'Accept this review and frame the exact job shown above.',
      confirmLabel: 'Accept & Frame',
    };
  }
  return {
    dialogTitle: 'Review job before starting',
    preparingTitle: 'Recomputing the job with your latest edits — one moment.',
    cancelTitle: 'Close this review without starting. Edits made here are kept.',
    confirmTitle: 'Start this job now with the settings shown above.',
    confirmLabel: 'Start job',
  };
}
