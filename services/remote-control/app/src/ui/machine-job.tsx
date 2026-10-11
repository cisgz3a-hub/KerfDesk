import { useRef, useState } from 'react';
import { controller } from '../core/controller';
import { formatDuration } from '../core/numbers';
import { store } from '../core/store';
import type { MachineStatus } from '../core/types';
import { useApp } from './hooks';
import { Icon } from './icons';
import { ActionButton, operationLabel } from './machine-parts';
import { Banner, Sheet } from './primitives';

export function JobCard({ machine }: { machine: MachineStatus }) {
  const operation = useApp((state) => state.operation);
  const a = machine.availability;
  const job = machine.job;
  const busy =
    operation !== null && ['accepted', 'preparing', 'starting'].includes(operation.state);
  if (job.active) return <RunningCard machine={machine} />;
  const framed = machine.frame.complete;
  const reviewing = operation?.state === 'awaiting_review' && operation.review !== undefined;
  return (
    <div className="card">
      <div className="card-title">Run the job</div>
      <div className="stepper">
        <div className={`step ${framed ? 'done' : 'active'}`}>
          <span className="step-num">{framed ? <Icon name="check" size={18} /> : '1'}</span>
          <div>
            <div className="step-title">Frame</div>
            <div className="step-sub">Trace the outline with the tool off.</div>
          </div>
          <ActionButton
            icon="frame"
            label={framed ? 'Again' : 'Frame'}
            primary={!framed}
            availability={a.frame}
            onClick={() => void controller.machineAction('frame_job')}
          />
        </div>
        <div className={`step ${reviewing ? 'done' : framed ? 'active' : ''}`}>
          <span className="step-num">2</span>
          <div>
            <div className="step-title">Review</div>
            <div className="step-sub">Time, warnings and settings for this exact job.</div>
          </div>
          <ActionButton
            icon="props"
            label="Review"
            primary={framed && !reviewing}
            availability={a.review}
            onClick={() =>
              reviewing
                ? store.set({ sheet: { kind: 'review' } })
                : void controller.machineAction('review_machine_job')
            }
          />
        </div>
        <div className={`step ${reviewing ? 'active' : ''}`}>
          <span className="step-num">3</span>
          <div>
            <div className="step-title">Start</div>
            <div className="step-sub">Slide to confirm in the review.</div>
          </div>
          <ActionButton
            icon="play"
            label="Start"
            availability={
              reviewing
                ? { available: true }
                : { available: false, reason: 'Review the job first.' }
            }
            onClick={() => store.set({ sheet: { kind: 'review' } })}
          />
        </div>
      </div>
      {busy ? (
        <p className="note" role="status">
          <span
            className="spinner"
            style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }}
          />
          {operationLabel(operation?.kind, operation?.state)}
        </p>
      ) : null}
      {operation?.message !== undefined && !busy ? (
        <p className="note">{operation.message}</p>
      ) : null}
    </div>
  );
}

export function RunningCard({ machine }: { machine: MachineStatus }) {
  const job = machine.job;
  const percent = Math.round(job.progressPercent ?? 0);
  const paused = job.state === 'paused';
  return (
    <div className="card">
      <div className="card-title">
        {paused ? 'Paused' : job.state === 'starting' ? 'Starting' : 'Running'}
      </div>
      <div className="running">
        <div className="ring" style={{ ['--p' as string]: percent }}>
          <div>
            <b>{percent}%</b>
          </div>
        </div>
        <div className="stack">
          <div>
            <div className="muted small">Elapsed</div>
            <div style={{ font: '650 18px var(--mono)' }}>{formatDuration(job.elapsedSeconds)}</div>
          </div>
          <div>
            <div className="muted small">Remaining</div>
            <div style={{ font: '650 18px var(--mono)' }}>
              {formatDuration(job.remainingSeconds)}
            </div>
          </div>
        </div>
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        {paused ? (
          <ActionButton
            icon="play"
            label="Resume"
            primary
            availability={machine.availability.resume}
            onClick={() => void controller.machineAction('resume_job', {}, false)}
          />
        ) : (
          <ActionButton
            icon="pause"
            label="Pause"
            availability={machine.availability.pause}
            onClick={() => void controller.machineAction('pause_job', {}, false)}
          />
        )}
      </div>
    </div>
  );
}

export function ReviewSheet() {
  const operation = useApp((state) => state.operation);
  const review = operation?.review;
  const close = () => store.set({ sheet: null });
  if (review === undefined || operation === null)
    return (
      <Sheet title="Job review" onClose={close}>
        <p className="muted">Prepare the review first.</p>
      </Sheet>
    );
  const start = () => {
    close();
    void controller.machineAction('start_job', { reviewId: review.reviewId });
  };
  return (
    <Sheet
      title="Review this job"
      onClose={close}
      footer={<SlideToStart disabled={!review.frame.complete} onConfirm={start} />}
    >
      {!review.frame.complete ? (
        <Banner tone="warning">Frame this job before starting.</Banner>
      ) : null}
      <div className="grid-2">
        {review.stats.map((stat) => (
          <div key={stat.label} className="card" style={{ padding: 12, boxShadow: 'none' }}>
            <div className="muted small">{stat.label}</div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{stat.value}</div>
            {stat.detail === '' ? null : <div className="muted small">{stat.detail}</div>}
          </div>
        ))}
      </div>
      {review.warnings.length > 0 ? (
        <div className="stack">
          {review.warnings.map((warning, index) => (
            <Banner key={`${warning.code}-${index}`} tone="warning">
              {warning.message}
            </Banner>
          ))}
        </div>
      ) : (
        <Banner tone="success">No warnings for this job.</Banner>
      )}
      {review.operations.map((item) => (
        <div key={item.operationId} className="card" style={{ padding: 12, boxShadow: 'none' }}>
          {item.summaries.map((line, index) => (
            <div
              key={index}
              className={index === 0 ? '' : 'muted small'}
              style={index === 0 ? { fontWeight: 650 } : undefined}
            >
              {line}
            </div>
          ))}
        </div>
      ))}
      {review.pagination?.nextOffset != null ? (
        <button
          type="button"
          className="btn"
          onClick={() =>
            void controller.reviewPage(review.reviewId, review.pagination?.nextOffset ?? 0)
          }
        >
          Show more
        </button>
      ) : null}
      {review.acknowledgement.prompt === undefined ? null : (
        <p style={{ fontWeight: 600 }}>{review.acknowledgement.prompt}</p>
      )}
      <p className="note">
        Sliding starts this exact program on the machine. If anything changes, you’ll review again.
      </p>
    </Sheet>
  );
}

/** A deliberate gesture for a physical action; it only confirms the reviewed program. */
function SlideToStart({ onConfirm, disabled }: { onConfirm: () => void; disabled: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const start = useRef<number | null>(null);
  const max = () => Math.max(1, (track.current?.clientWidth ?? 300) - 60);
  return (
    <div
      ref={track}
      className={`slide${disabled ? ' disabled' : ''}`}
      style={{ flex: 1 }}
      role="slider"
      aria-label="Slide to start the job"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((offset / max()) * 100)}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onConfirm();
        }
      }}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = event.clientX - offset;
      }}
      onPointerMove={(event) => {
        if (start.current === null) return;
        setOffset(Math.max(0, Math.min(max(), event.clientX - start.current)));
      }}
      onPointerUp={() => {
        if (start.current === null) return;
        start.current = null;
        if (offset >= max() * 0.92) {
          navigator.vibrate?.([10, 40, 10]);
          onConfirm();
        }
        setOffset(0);
      }}
      onPointerCancel={() => {
        start.current = null;
        setOffset(0);
      }}
    >
      <div className="slide-fill" style={{ width: offset + 56 }} />
      <div className="slide-label">Slide to start</div>
      <div className="slide-knob" style={{ transform: `translateX(${offset}px)` }}>
        <Icon name="play" />
      </div>
    </div>
  );
}
