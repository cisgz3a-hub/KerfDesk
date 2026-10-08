import { Button, Dialog, DialogActions } from '../kit';
import type { StampPreparationReview } from './use-stamp-preparation';
export function StampPreparationDialog({
  review,
}: {
  readonly review: StampPreparationReview;
}): JSX.Element {
  const ready = review.current && review.draft !== null && review.reviewed && !review.busy;
  return (
    <Dialog title="Prepare Stamp" size="md" onClose={review.close}>
      <p>
        Choose dark artwork as the raised face. Review a mirrored face mask and a grayscale height
        intent with measured shoulders.
      </p>
      <StampFields review={review} />
      <div style={{ display: 'flex', gap: 8, marginBlock: 12 }}>
        <Button
          disabled={!review.current || review.busy}
          onClick={() => {
            void review.prepare();
          }}
        >
          Prepare preview
        </Button>
        {review.busy && <Button onClick={review.stop}>Stop preparation</Button>}
      </div>
      <StampPreview review={review} />
      <p style={{ fontSize: 12 }}>
        Raw source pixels and existing image masks define the face; brightness, contrast,
        negative-image and operation settings are not baked in. Mirroring is along the image X axis;
        existing placement, rotation and reflections remain. White faces are flat, black is
        recessed, and the shoulder decreases linearly over the chosen distance from face pixel
        edges. This is a sampled design, not a material depth or power calibration.
      </p>
      <p style={{ fontSize: 12 }}>
        Apply adds an image with ordinary image-operation defaults. Set proportional laser power or
        CNC relief depth through existing tools for your material. Qualify a physical coupon before
        using the stamp. PNG exports pixels; set the displayed mm extent when importing. Stamp
        quality is unqualified.
      </p>
      <p role="status" aria-live="polite">
        {!review.current
          ? 'Artwork or selection changed. Reopen before accepting.'
          : review.busy
            ? 'Preparing pixels in the background…'
            : review.error}
      </p>
      {review.draft !== null && (
        <label className="lf-field">
          <input
            type="checkbox"
            title="Confirm that this draft's face, mirroring, physical extent and shoulders are ready to apply or export."
            checked={review.reviewed}
            onChange={(event) => review.setReviewed(event.currentTarget.checked)}
          />
          <span>I reviewed the face, mirroring, dimensions and height map.</span>
        </label>
      )}
      <DialogActions>
        <Button onClick={review.close}>Cancel</Button>
        <Button disabled={!ready} onClick={review.save}>
          Export PNG…
        </Button>
        <Button variant="primary" disabled={!ready} onClick={review.apply}>
          Apply as new image
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function StampFields({ review }: { readonly review: StampPreparationReview }): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {(
        [
          ['taperMm', 'Measured taper width (mm)'],
          ['threshold', 'Source threshold (0–254)'],
          ['dpi', 'Vector raster DPI'],
        ] as const
      ).map(([key, label]) => (
        <label
          key={key}
          className="lf-field"
          style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}
        >
          <span>{label}</span>
          <input
            className="lf-input"
            aria-label={label}
            title={
              key === 'taperMm'
                ? 'Set the measured shoulder width in millimetres from the raised face edges; zero creates a binary face.'
                : key === 'threshold'
                  ? 'Include raw source pixels at or below this grayscale value in the raised face; 0 is black and 254 excludes white.'
                  : 'Set vector sampling density in dots per inch; raster sources keep their original pixel dimensions.'
            }
            inputMode="decimal"
            value={review.form[key]}
            onChange={(event) => review.change({ [key]: event.currentTarget.value })}
          />
        </label>
      ))}
      <label className="lf-field">
        <input
          type="checkbox"
          aria-label="Mirror raised face"
          title="Reflect the raised face along the image X axis while retaining the artwork's existing placement and transform."
          checked={review.form.mirror}
          onChange={(event) => review.change({ mirror: event.currentTarget.checked })}
        />
        <span>Mirror raised face</span>
      </label>
      <span style={{ fontSize: 12 }}>
        Threshold includes source luma ≤ the chosen value. Vector DPI affects vectors; raster
        sources retain their exact pixels. A zero taper produces a binary face. A black margin is
        added around the source.
      </span>
    </div>
  );
}
function StampPreview({ review }: { readonly review: StampPreparationReview }): JSX.Element | null {
  const draft = review.draft?.pixels;
  if (draft === undefined) return null;
  const url =
    review.preview === 'source'
      ? draft.sourceDataUrl
      : review.preview === 'face'
        ? draft.faceDataUrl
        : draft.dataUrl;
  return (
    <section aria-label="Stamp draft preview">
      <div style={{ display: 'flex', gap: 6 }}>
        {(['source', 'face', 'height'] as const).map((kind) => (
          <Button
            key={kind}
            aria-pressed={review.preview === kind}
            onClick={() => review.setPreview(kind)}
          >
            {kind === 'source'
              ? 'Source'
              : kind === 'face'
                ? review.form.mirror
                  ? 'Mirrored face mask'
                  : 'Face mask'
                : 'Height map'}
          </Button>
        ))}
      </div>
      <img
        alt={
          review.preview === 'source'
            ? 'Raw source pixels'
            : review.preview === 'face'
              ? 'Thresholded raised face mask'
              : 'White raised face with graded shoulders and black recess'
        }
        src={url}
        style={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: 280,
          marginBlock: 8,
          imageRendering: 'pixelated',
        }}
      />
      <p>
        {draft.width} × {draft.height} pixels; {draft.widthMm.toFixed(3)} ×{' '}
        {draft.heightMm.toFixed(3)} mm including margin. Pixel pitch {draft.pitchXmm.toFixed(4)} ×{' '}
        {draft.pitchYmm.toFixed(4)} mm. {draft.facePixels} face pixels. Shoulder detail depends on
        this pitch.
      </p>
    </section>
  );
}
