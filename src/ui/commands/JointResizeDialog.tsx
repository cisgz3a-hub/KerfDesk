import { Button, Dialog, DialogActions } from '../kit';
import { JointResizePreview } from './JointResizePreview';
import type { JointResizeForm, JointResizeReview } from './use-joint-resize-review';
const FIELDS: ReadonlyArray<readonly [keyof JointResizeForm, string, string]> = [
  [
    'currentWidthMm',
    'Current opening width (mm)',
    'Find geometric widths near this declared original design width.',
  ],
  [
    'materialThicknessMm',
    'Material thickness (mm)',
    'Use your measured stock thickness. This tool does not measure the material.',
  ],
  [
    'fitAllowanceMm',
    'Fit allowance (mm)',
    'Positive widens receiving openings; negative tightens them. This is a design allowance, separate from tool/kerf compensation.',
  ],
  [
    'detectionToleranceMm',
    'Detection tolerance (mm)',
    'How far a measured design width can differ from Current opening width.',
  ],
];
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
        Detects orthogonal inward U-slots and enclosed rectangular contours with one matching
        dimension. Excludes square ambiguity, curved/open artwork and unsupported geometry. Tabs,
        finger-joint depth, rounded slots and general thickness conversion require explicit design
        edits. Tool/kerf settings remain separate. Test a fit coupon for your material and process.
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
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {FIELDS.map(([key, label, title]) => (
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
      ))}
    </div>
  );
}
function JointResizeCandidates({ review }: { readonly review: JointResizeReview }): JSX.Element {
  const { analysis } = review;
  if (analysis.kind === 'error') return <p role="alert">{analysis.error.message}</p>;
  return (
    <>
      <p>
        Resulting opening width: <strong>{analysis.value.targetWidthMm.toFixed(3)} mm</strong> =
        thickness + fit allowance. Depth and the opening centre stay fixed.
      </p>
      <div
        style={{ maxHeight: 160, overflowY: 'auto' }}
        role="group"
        aria-label="Detected receiving features"
      >
        {analysis.value.candidates.map((candidate, index) => (
          <label key={candidate.id} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={review.chosen.includes(candidate.id)}
              title="Choose this feature only after checking its location in the preview and its intended use."
              onChange={(event) => review.choose(candidate.id, event.currentTarget.checked)}
            />
            {index + 1}. {candidate.objectId}:{' '}
            {candidate.kind === 'inward-slot' ? 'inward U-slot' : 'enclosed rectangle'} · width{' '}
            {candidate.widthMm.toFixed(3)} mm · depth {candidate.depthMm.toFixed(3)} mm
          </label>
        ))}
        {analysis.value.candidates.length === 0 && (
          <p>No unambiguous geometric candidates match this width.</p>
        )}
      </div>
      {analysis.value.notices.map((notice) => (
        <p key={notice} style={{ fontSize: 12 }}>
          {notice}
        </p>
      ))}
    </>
  );
}
