import { Button, Dialog, DialogActions } from '../kit';
import { formatLengthWithUnit, lengthUnitLabel } from '../display-length';
import type { JointCandidate } from '../../core/geometry/joint-resize';
import { JointResizePreview } from './JointResizePreview';
import type { JointResizeForm, JointResizeReview } from './use-joint-resize-review';
const FIELDS: ReadonlyArray<readonly [keyof JointResizeForm, string, string]> = [
  [
    'currentWidthMm',
    'Current opening width',
    'Find openings this wide, and tabs this deep, near this declared original design width.',
  ],
  [
    'materialThicknessMm',
    'Material thickness',
    'Use your measured stock thickness. This tool does not measure the material.',
  ],
  [
    'fitAllowanceMm',
    'Fit allowance',
    'Positive widens receiving openings; negative tightens them. This is a design allowance, separate from tool/kerf compensation.',
  ],
  [
    'detectionToleranceMm',
    'Detection tolerance',
    'How far a measured design width can differ from Current opening width.',
  ],
];
const JOINT_KIND_LABELS = {
  'inward-slot': 'inward U-slot',
  'enclosed-rectangle': 'enclosed rectangle',
  'outward-tab': 'outward tab',
} as const;

export function JointResizeDialog({ review }: { readonly review: JointResizeReview }): JSX.Element {
  const { analysis, preview, current } = review;
  return (
    <Dialog
      title="Resize Joint Openings"
      size="md"
      as="form"
      onClose={review.close}
      onSubmit={(event) => {
        event.preventDefault();
        review.apply();
      }}
    >
      <p>
        Review receiving openings in imported or traced straight paths. Check the intended fit
        before selecting each feature. Candidate geometry cannot establish manufacturing intent.
      </p>
      <JointResizeFields review={review} />
      <JointResizeCandidates review={review} />
      <JointResizePreview
        before={review.displaySources}
        after={review.after}
        candidates={analysis.kind === 'ok' ? analysis.value.candidates : []}
        selected={review.chosen}
      />
      <p style={{ fontSize: 12 }}>
        Detects orthogonal inward U-slots and enclosed rectangular cutouts with one matching
        dimension, and outward tabs whose depth matches; a tab&apos;s depth becomes the material
        thickness, growing from its root. Excludes square ambiguity, curved/open artwork and
        unsupported geometry. A finger-jointed outline is left out when its corner fingers would
        stay at the old depth; generate a Box Generator box again at the new thickness. Rounded
        slots and general thickness conversion require explicit design edits. Tool/kerf settings
        remain separate. Test a fit coupon for your material and process.
      </p>
      <p role="status" aria-live="polite">
        {!current
          ? 'Artwork or selection changed. Reopen the tool before applying.'
          : preview.kind === 'ok'
            ? `${preview.value.changedFeatures} verified feature(s) selected. Apply changes the artwork in one undo step.`
            : preview.error.message}
      </p>
      <DialogActions>
        <Button onClick={review.close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!current || preview.kind !== 'ok'}>
          Apply selected openings
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function JointResizeFields({ review }: { readonly review: JointResizeReview }): JSX.Element {
  const unit = lengthUnitLabel(review.unit);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {FIELDS.map(([key, name, title]) => {
        const label = `${name} (${unit})`;
        return (
          <label
            key={key}
            className="lf-field"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 140px',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>{label}</span>
            <input
              className="lf-input"
              type="text"
              inputMode="decimal"
              aria-label={label}
              title={title}
              value={review.form[key]}
              onChange={(event) => review.change(key, event.currentTarget.value)}
            />
          </label>
        );
      })}
    </div>
  );
}
function JointResizeCandidates({ review }: { readonly review: JointResizeReview }): JSX.Element {
  const { analysis, unit } = review;
  if (analysis.kind === 'error') return <p role="alert">{analysis.error.message}</p>;
  const { candidates } = analysis.value;
  const length = (mm: number): string => formatLengthWithUnit(mm, unit);
  return (
    <>
      <p>
        Resulting opening width: <strong>{length(analysis.value.targetWidthMm)}</strong> = thickness
        + fit allowance. {resizeSummary(candidates)}
      </p>
      <div
        style={{ maxHeight: 160, overflowY: 'auto' }}
        role="group"
        aria-label="Detected receiving features"
      >
        {candidates.map((candidate, index) => (
          <label key={candidate.id} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={review.chosen.includes(candidate.id)}
              title="Choose this feature only after checking its location in the preview and its intended use."
              onChange={(event) => review.choose(candidate.id, event.currentTarget.checked)}
            />
            {index + 1}. {candidate.objectName}: {JOINT_KIND_LABELS[candidate.kind]} · width{' '}
            {length(candidate.widthMm)} · depth {length(candidate.depthMm)}
          </label>
        ))}
        {candidates.length === 0 && <p>No unambiguous geometric candidates match this width.</p>}
      </div>
      {analysis.value.notices.map((notice) => (
        <p key={notice} style={{ fontSize: 12 }}>
          {notice}
        </p>
      ))}
    </>
  );
}

/** What stays put: an opening keeps its depth and centre, a tab its width and root. */
function resizeSummary(candidates: ReadonlyArray<JointCandidate>): string {
  const tabs = candidates.some((candidate) => candidate.kind === 'outward-tab');
  const openings = candidates.some((candidate) => candidate.kind !== 'outward-tab');
  if (tabs && openings)
    return 'An opening keeps its depth and centre; a tab keeps its width and root, and its depth becomes the bare thickness.';
  if (tabs) return 'Each tab keeps its width and root; its depth becomes the bare thickness.';
  return 'Depth and the opening centre stay fixed.';
}
