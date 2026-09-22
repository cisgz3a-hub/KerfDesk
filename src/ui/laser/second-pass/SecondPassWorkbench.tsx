import { formatDuration } from '../../../core/job';
import { Dialog } from '../../kit';
import type { ExecutionArtifactV1 } from '../../state/recovery';
import { useJobReviewStore } from '../job-review/job-review-store';
import { SecondPassAbortButton } from './SecondPassAbortButton';
import { SecondPassCanvas } from './SecondPassCanvas';
import { SecondPassTools } from './SecondPassTools';
import { SECOND_PASS_BUSY } from './second-pass-workbench-actions';
import { useSecondPassWorkbench, type SecondPassWorkbenchModel } from './use-second-pass-workbench';
import './second-pass.css';

export function SecondPassWorkbench(props: {
  source: ExecutionArtifactV1;
  onClose: () => void;
}): JSX.Element | null {
  const model = useSecondPassWorkbench(props.source, props.onClose);
  const reviewOpen = useJobReviewStore((s) => s.state.kind === 'open');
  // Review owns the modal while confirming. Keep this component mounted to
  // retain its draft and permit without two competing focus traps.
  if (reviewOpen && model.busy === SECOND_PASS_BUSY.review) return null;
  return (
    <Dialog
      title="Paint a second pass"
      size="xl"
      panelClassName="second-pass-workbench"
      onClose={model.close}
    >
      <p className="second-pass-intro">
        Brush over the parts you want darker or cut deeper, then erase any spill. Preview the pass,
        Frame its path, and Start when you are ready.
      </p>
      <p className="second-pass-hint">
        Saved run: {new Date(props.source.createdAtIso).toLocaleString()} ·{' '}
        {props.source.prepared.project.device.name} · Keep the workpiece and work origin in their
        original positions.
      </p>
      {props.source.laserSecondPassChain?.length || props.source.laserResumeChain?.length ? (
        <p className="second-pass-hint">
          This retained source is a recovered remainder or an earlier second pass. You can paint
          only the engraving shown here.
        </p>
      ) : null}
      <WorkbenchDrawing source={props.source} model={model} />
      <WorkbenchStatus model={model} />
      <WorkbenchFooter model={model} />
    </Dialog>
  );
}

function WorkbenchDrawing({
  source,
  model,
}: {
  source: ExecutionArtifactV1;
  model: SecondPassWorkbenchModel;
}): JSX.Element {
  if (!model.drawing) return <div className="second-pass-layout" />;
  return (
    <div className="second-pass-layout">
      <SecondPassCanvas
        drawing={model.drawing}
        preview={model.preview?.drawing ?? null}
        device={source.prepared.project.device}
        strokes={model.strokes}
        tool={model.tool}
        radiusMm={model.diameter / 2}
        powerScale={model.power / 100}
        disabled={model.busy !== ''}
        showPreview={model.showPreview}
        onStroke={model.addStroke}
      />
      <SecondPassTools {...model.tools} />
    </div>
  );
}

function WorkbenchStatus({ model }: { model: SecondPassWorkbenchModel }): JSX.Element {
  return (
    <>
      {model.busy ? (
        <p className="second-pass-status" role="status">
          {model.busy}
        </p>
      ) : null}
      {model.error ? (
        <p className="second-pass-status" role="alert">
          {model.error}
        </p>
      ) : null}
      {!model.draftSaved ? (
        <p className="second-pass-status" role="alert">
          This browser could not save the painted draft. Keep this window open to retain your
          selection.
        </p>
      ) : null}
    </>
  );
}

function WorkbenchFooter({ model: m }: { model: SecondPassWorkbenchModel }): JSX.Element {
  return (
    <div className="second-pass-footer">
      <p>{previewDescription(m)}</p>
      <SecondPassAbortButton />
      <button
        className="lf-btn lf-btn--sm"
        disabled={m.working.current && m.busy !== SECOND_PASS_BUSY.compile}
        onClick={m.close}
        title="Close this window. Successfully saved painted drafts remain available on this device."
      >
        Close
      </button>
      {m.preview ? (
        <button
          className="lf-btn lf-btn--sm"
          disabled={m.busy !== ''}
          onClick={() => m.setShowPreview(!m.showPreview)}
          title={
            m.showPreview
              ? 'Return to painting and erasing the selected areas.'
              : 'Inspect the exact engraving prepared for the painted areas.'
          }
        >
          {m.showPreview ? 'Edit painted areas' : 'Show engraving preview'}
        </button>
      ) : null}
      <button
        className="lf-btn lf-btn--sm"
        disabled={
          m.busy !== '' || !m.drawing || !m.strokes.some((stroke) => stroke.mode === 'paint')
        }
        onClick={m.compile}
        title="Prepare and inspect engraving within the painted areas without moving the machine."
      >
        Preview second pass
      </button>
      <button
        className="lf-btn lf-btn--sm"
        disabled={m.busy !== '' || !m.preview || !m.connected}
        onClick={m.frame}
        title="Trace the prepared second-pass bounds with the laser off. A completed Frame enables Start."
      >
        Frame second pass
      </button>
      <button
        className="lf-btn lf-btn--primary"
        disabled={m.busy !== '' || !m.ready || !m.connected}
        onClick={m.start}
        title="Review and start the exact second pass prepared by the completed Frame."
      >
        Start second pass
      </button>
    </div>
  );
}

function previewDescription(model: SecondPassWorkbenchModel): string {
  if (!model.preview) return 'Painted drafts are saved on this device.';
  const duration = model.preview.prepared.metrics.duration;
  const time = duration.unavailableReason
    ? 'Time estimate unavailable'
    : `about ${formatDuration(duration.totalSeconds)}`;
  return `${model.preview.burnLengthMm.toFixed(1)} mm of engraving · ${time} · ${model.ready ? 'Frame complete' : 'Frame required'}`;
}
