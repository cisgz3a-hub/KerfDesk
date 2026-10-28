import { JobReviewRegistrationJig, registrationJigConfirmLabel } from './JobReviewRegistrationJig';
// JobReviewDialog — the pre-start Job Review window (ADR-224). Opens for
// every Start that goes through the shared start flow and shows what the
// burn depends on at a glance (v3): stat tiles from the exact prepared
// G-code, one-line warnings, a card per operation whose laser core numbers
// Edit and Save straight to the main settings (CNC read-only), CNC material
// & stock, folded live controller/machine facts, and the absorbed safety
// acknowledgement. It hands the operator's Confirm/Cancel back to the flow's
// review gate. Placement is read-only here (v2): the origin tile and the
// footer fact echo it, editing stays on the machine rail.

import { useEffect, useRef, type RefObject } from 'react';
import { Button, Dialog, Icon } from '../../kit';
import { useJobReviewStore, type JobReviewPurpose, type JobReviewState } from './job-review-store';
import {
  bannerListStyle,
  bannerStyle,
  footerBarStyle,
  footerOriginStyle,
  machineFactsGridStyle,
  startButtonContentStyle,
} from './job-review.styles';
import { JobReviewAcknowledgement } from './JobReviewAcknowledgement';
import { JobReviewCncOwnerActions } from './JobReviewCncOwnerActions';
import { JobReviewControllerSection } from './JobReviewControllerSection';
import { JobReviewHeader } from './JobReviewHeader';
import { JobReviewMachineSection } from './JobReviewMachineSection';
import { JobReviewOperations } from './JobReviewOperations';
import { JobReviewStats } from './JobReviewStats';
import { JobReviewStockCard } from './JobReviewStockCard';
import { JobReviewWarnings } from './JobReviewWarnings';
import { useJobReviewRebuildTrigger } from './use-job-review-rebuild';
import { useLaserStore } from '../../state/laser-store';
import type { JobReviewModel } from './job-review-model';
import type { JobReviewOmissions } from './job-review-omissions';

export const SAVE_EDIT_BEFORE_START_TITLE = 'Save or discard your settings change first.';

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
  const requestReviewRebuild = useJobReviewRebuildTrigger();
  // Operation cards report Edit/Save; Start waits while any card holds an
  // unsaved draft, so the job never runs values other than the ones shown.
  // The store holds it, so a remote approval waits too (ADR-638 Amendment 1).
  const isEditing = useJobReviewStore((s) => s.editingOperationIds.size > 0);
  const reportEditing = useJobReviewStore((s) => s.reportEditing);
  useReviewInitialFocus(topAnchorRef);
  const handleCancel = (): void => useJobReviewStore.getState().cancel();
  const startDisabledReason = isPreparing
    ? copy.preparingTitle
    : blocker !== null
      ? blocker.join('\n')
      : isEditing
        ? SAVE_EDIT_BEFORE_START_TITLE
        : null;
  const handleConfirm = (): void => {
    if (startDisabledReason === null) useJobReviewStore.getState().confirm();
  };
  return (
    <Dialog title={copy.dialogTitle} size="xl" onClose={handleCancel}>
      <span ref={topAnchorRef} aria-hidden="true" />
      <JobReviewHeader
        machineKind={model.machineKind}
        laserModeVerified={model.acknowledgement.kind === 'laser-verified'}
      />
      <JobReviewRegistrationJig
        output={model.registrationJigOutput}
        wholeOutput={model.registrationJigWholeOutput}
        isPreparing={isPreparing}
      />
      <JobReviewStats stats={model.stats} isPreparing={isPreparing} />
      {blocker !== null ? (
        <BlockerBanner blocker={blocker} purpose={purpose} onRetry={requestReviewRebuild} />
      ) : null}
      <JobReviewWarnings warnings={model.warnings} {...reviewedArtworkActions(model, purpose)} />
      <ReviewArtwork
        model={model}
        purpose={purpose}
        onSaved={requestReviewRebuild}
        onEditingChange={reportEditing}
      />
      <ReviewMachineFacts model={model} purpose={purpose} />
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
            {registrationJigConfirmLabel(model.registrationJigOutput, purpose, copy.confirmLabel)}
          </span>
        </Button>
      </div>
    </Dialog>
  );
}

// The canvas actions beside the warnings. A painted second pass has no source
// artwork on the canvas to show.
function reviewedArtworkActions(
  model: JobReviewModel,
  purpose: JobReviewPurpose,
): JobReviewOmissions {
  if (purpose === 'laser-second-pass') return {};
  const { openFillOmissions, openCncContourOmissions, stackedFillCopies } = model;
  return {
    ...(openFillOmissions === undefined ? {} : { openFillOmissions }),
    ...(openCncContourOmissions === undefined ? {} : { openCncContourOmissions }),
    ...(stackedFillCopies === undefined ? {} : { stackedFillCopies }),
  };
}

function ReviewArtwork(props: {
  model: JobReviewModel;
  purpose: JobReviewPurpose;
  onSaved: () => void;
  onEditingChange: (operationId: string, isEditing: boolean) => void;
}): JSX.Element {
  if (props.purpose === 'laser-second-pass')
    return (
      <p>
        Painted areas and their power are fixed to the completed Frame. To change them, cancel, edit
        the second pass, then Frame it again.
      </p>
    );
  return (
    <>
      <JobReviewOperations
        machineKind={props.model.machineKind}
        effectiveOperations={props.model.effectiveOperations}
        onSaved={props.onSaved}
        onEditingChange={props.onEditingChange}
      />
      {props.model.machineKind === 'cnc' ? (
        <>
          <JobReviewCncOwnerActions />
          <JobReviewStockCard />
        </>
      ) : null}
    </>
  );
}

function ReviewMachineFacts({
  model,
  purpose,
}: {
  model: JobReviewModel;
  purpose: JobReviewPurpose;
}): JSX.Element {
  const frozenProject = useLaserStore((s) => s.framedRun?.candidate.project);
  const context =
    purpose === 'laser-second-pass' && frozenProject ? { project: frozenProject } : {};
  return (
    <section aria-label="Controller and machine" style={machineFactsGridStyle}>
      <JobReviewControllerSection machineKind={model.machineKind} {...context} />
      <JobReviewMachineSection
        machineKind={model.machineKind}
        toolPlanLabels={model.toolPlanLabels}
        outputQualityFacts={model.outputQualityFacts}
        {...(model.startFrom === undefined ? {} : { startFrom: model.startFrom })}
        {...context}
      />
    </section>
  );
}

// The kit's dialog a11y focuses the first focusable child — here that is a
// button two sections down, which both opens the review scrolled past its
// header and lets a stray keystroke act sight-unseen. A review opens as a
// document: show it from the top and focus the dialog surface itself (still
// inside the focus trap; Tab reaches the controls next). One animation frame
// later than the kit's focus so this wins the race.
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
  readonly onRetry: () => void;
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
      <Button onClick={props.onRetry}>Retry preparation</Button>
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
  if (purpose === 'laser-second-pass')
    return {
      dialogTitle: 'Review painted second pass',
      preparingTitle: 'Checking the framed second pass and current controller.',
      cancelTitle: 'Return to the painted areas without starting.',
      confirmTitle: 'Run the exact painted pass that completed Frame.',
      confirmLabel: 'Start second pass',
    };
  if (purpose === 'frame') {
    return {
      dialogTitle: 'Review job before framing',
      preparingTitle: 'Recomputing the job with your latest edits before framing — one moment.',
      cancelTitle: 'Close this review without framing. Saved edits are kept.',
      confirmTitle: 'Accept this review and frame the exact job shown above.',
      confirmLabel: 'Accept & Frame',
    };
  }
  return {
    dialogTitle: 'Review job before starting',
    preparingTitle: 'Recomputing the job with your latest edits — one moment.',
    cancelTitle: 'Close this review without starting. Saved edits are kept.',
    confirmTitle: 'Start this job now with the settings shown above.',
    confirmLabel: 'Start job',
  };
}
